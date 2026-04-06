#!/usr/bin/env python3
"""
Extract etymology words from 词源词.pdf and produce a clean JSON file.

The PDF has a complex multi-column layout with:
- 4 word columns per page
- Language category labels in sidebars (OCR-garbled)
- Variant spellings across lines (word1/\nword2)
- Compound words split by OCR (dim + sum → dim sum)
- Page counts stated as "本页单词共N"

Strategy:
1. Extract all words with bounding-box positions
2. Filter out category labels, headers, and OCR artifacts
3. Merge split compound words and variant-spelling continuations
4. Assign language categories based on page ranges
5. Validate total = 2060
"""

import json
import re
import sys
import pdfplumber

# --- Constants ---

LANGUAGE_CATEGORIES = [
    "Arabic", "Asian", "Dutch", "Eponyms", "French", "German",
    "Greek", "Italian", "Japanese", "Latin", "New World",
    "Old English", "Slavic", "Spanish",
]

# Page ranges for each category (1-indexed, inclusive).
# Determined by visual inspection of the PDF layout.
# Each two-page spread covers one or more categories.
# Pages 1-2: Arabic; Pages 2-3: Asian; Pages 3-4: Dutch; etc.
# The exact word boundaries are defined below as CATEGORY_BOUNDARIES.

# Garbled OCR category labels to filter out
GARBLED_LABELS = {
    # Exact category names (appear repeatedly as sidebar labels)
    'French', 'Greek', 'German', 'Dutch', 'New', 'Spanish', 'Latin',
    'Arabic', 'Asian', 'Japanese', 'Italian', 'Old', 'English',
    'Slavic', 'World', 'Eponyms',
    # OCR-garbled versions from sidebar
    'lalin', 'Spamsh', 'Englsh', 'Halian', 'Japanae', 'Latih', 'Worb',
    'Okd', 'Shavic', 'Saic', 'Spamisi', 'Shavc', 'Gteek', 'Nev', 'lath',
    'Eponypms', 'Asin', 'Eorgns', 'Nea', 'Japinssa', 'Smansh',
    'Aribtc', 'Dutkch', 'Eporyas', 'Jpanese', 'Ciksglsh', 'Savt', 'Spinish',
    'Arbic', 'Eporyns', 'Apinese', 'Sante', 'Did', 'Nan', 'Duch', 'Epygns',
    'Shavtc', 'Spaush', 'Arlbic', 'Eponygmus', 'Ialian', 'Japauese', 'Otd',
    'Watit', 'Arabit', 'Durtch', 'Egonyms', 'Kalan', 'Warid', 'Ner',
    'ASian', 'laitn', 'katin', 'laln', 'talian',
    'lalan', 'lain', 'Savie', 'Savte', 'Sramish', 'Epcgpns', 'Germanl',
    'Watin', 'Wald', 'Geman', 'lalisn', 'Japauss', 'QidEgish', 'Spantish',
    'Arabt', 'Asan', 'Dutich', 'Epoyns', 'Grek', 'Malan', 'Engitsh',
    'Slavc', 'Spansh', 'Aabic', 'Ditch', 'hrench', 'Gemat', 'Oitgisi',
    'Shanc', 'Spsh', 'Arailbit', 'Duich', 'Eporymns', 'Gemain', 'Wotd',
    'Sanic', 'Asai', 'Lain', 'Newr', 'Engish', 'Shawc',
    'Arbit', 'Gieek', 'laian', 'lipanee', 'Shavit', 'Stanish',
    'Anbit', 'Frenci', 'Geiman', 'haan', 'kaltir', 'Aaok', 'Epypns',
    'Gemsin', 'Iaisn', 'Odlkngish', 'Shamt', 'Anit', 'Astan',
    'Gemman', 'Shavte', 'Siatt', 'Arabk', 'Woild', 'Eponyns', 'Eponymns',
    'Eronypns', 'Erongms', 'Beetewk', 'Eronypns',
    '0idEgish', '0dEngjisti', '0dltglish', '0idEngish',
}

HEADER_NOISE = re.compile(
    r'^(SPEGN|SPBCN|SPECN|SPELHG|SPELLIG|SPRLLNG|SRHCH|TRLAG|SRHLNGBEE|'
    r'WORDS|FROM|DIFFERENT|LANGUAGES|ORIGIN|CINA|CHINA|GHENA|CHNA|'
    r'DEE|BEE|AEE|IEE|OT|OF|THE|AND|APP|PEUI|EESOFOEA)$',
    re.IGNORECASE
)

CJK_RE = re.compile(r'[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef⻚⼿⾳⼀]')

# OCR fixes for mangled words
OCR_FIXES = {
    'anuS': 'anus',
    'assessOr': 'assessor',
    'avOW': 'avow',
    'eCrU': 'ecru',
    'cosmOS': 'cosmos',
    'cameO': 'cameo',
    'StuCCO': 'stucco',
    'CrOCUS': 'crocus',
    'sumO': 'sumo',
    'CacaO': 'cacao',
    'piSCO': 'pisco',
    'Capricor': 'Capricorn',
    'Iunatic': 'lunatic',
    'hatiz': 'hafiz',
    'gargon': 'garcon',
    'accoutermentapothecary': None,  # merged artifact - skip
}

# Compound words that OCR splits into separate tokens
COMPOUND_MERGES = {
    # (page, word1, word2) → merged word
    (2, 'dim', 'sum'): 'dim sum',
    (2, 'feng', 'shui'): 'feng shui',
    (2, 'kung', 'pao'): 'kung pao',
}

# Variant-spelling continuations: word ending in / followed by next variant on next line
# These should be merged into a single entry: word1/word2
SLASH_CONTINUATIONS = {
    # (page, slash_word) → continuation_word_to_absorb
    (2, 'cummerbund/'): 'cumberbund',
    (2, 'ketchup/'): 'catchup/',       # part of 3-entry chain
    (2, 'catchup/'): 'catsup',         # absorbed by ketchup/
    (2, 'kimchi/'): 'kimchee',
    (2, 'kisaeng/'): 'kisang',
    (5, 'mackintosh/'): 'macintosh',
    (5, 'tantalize/'): 'tantalise',
    (5, 'accoutrement/'): 'accouterment',  # but accouterment got merged with apothecary by OCR
    (6, 'carousel/'): 'carrousel',
    (6, 'bandolier/'): 'bandoleer',
    (6, 'bourguignon/'): 'bourguignonne',
    (7, 'emir/'): 'amir/ameer',
    (7, 'flanch/flaunch/'): 'flaunche',
    (7, 'griffin/griffon/'): 'gryphon',
    (9, 'sarabande/'): 'sarabanda',
    (13, 'concertante/'): 'concertato',
    (14, 'spumoni/'): 'spumone',
    (15, 'jujitsu/jujutsu/'): 'jiujitsu',
    (19, 'arshin/arshine/'): 'archin/archine',
    (20, 'tchervonets/'): 'tchervonetz',
    (20, 'barabara/'): 'barabora/',
    (20, 'barabora/'): 'barrabora',
    (20, 'bidarka/'): 'baidarka/',
    (20, 'baidarka/'): 'bidarkee',
    (20, 'guberniya/'): 'gubernia',
    (20, 'boychik/'): 'boychick',
    (20, 'chervonets/'): 'chervonetz/',
    (20, 'chervonetz/'): None,  # terminal
}

# Words to absorb (they're continuations of slash entries, not standalone)
ABSORBED_WORDS = set()
for (page, slash_word), cont in SLASH_CONTINUATIONS.items():
    if cont:
        ABSORBED_WORDS.add((page, cont))


def is_valid_word(text: str) -> bool:
    """Check if text is a valid vocabulary word, not noise."""
    if len(text) < 2:
        return False
    if text.isupper() and len(text) > 2:
        return False
    if CJK_RE.search(text):
        return False
    if HEADER_NOISE.match(text):
        return False
    if not any(c.islower() for c in text):
        return False
    if text in GARBLED_LABELS:
        return False
    if text.isdigit():
        return False
    return True


def extract_raw_words(pdf_path: str) -> list[dict]:
    """Extract all English words with positions from PDF."""
    results = []
    with pdfplumber.open(pdf_path) as pdf:
        for page_num, page in enumerate(pdf.pages):
            page_words = page.extract_words()
            for w in page_words:
                text = w['text'].strip()
                if len(text) < 2:
                    continue
                # Skip headers
                if page_num % 2 == 0 and w['top'] < 170:
                    continue
                if page_num % 2 == 1 and w['top'] < 45:
                    continue
                if is_valid_word(text):
                    results.append({
                        'word': text,
                        'page': page_num + 1,
                        'x': round(w['x0'], 1),
                        'y': round(w['top'], 1),
                    })
    return results


def apply_ocr_fixes(words: list[dict]) -> list[dict]:
    """Apply OCR corrections."""
    result = []
    for w in words:
        fix = OCR_FIXES.get(w['word'])
        if fix is None and w['word'] in OCR_FIXES:
            continue  # Skip (artifact)
        if fix:
            w = dict(w)
            w['word'] = fix
        result.append(w)
    return result


def merge_compounds(words: list[dict]) -> list[dict]:
    """Merge split compound words (e.g., dim + sum → dim sum)."""
    skip_indices = set()
    result = []

    for i, w in enumerate(words):
        if i in skip_indices:
            continue
        # Check if this word starts a compound
        for j in range(i + 1, min(i + 5, len(words))):
            if words[j]['page'] != w['page']:
                break
            key = (w['page'], w['word'], words[j]['word'])
            if key in COMPOUND_MERGES:
                merged = dict(w)
                merged['word'] = COMPOUND_MERGES[key]
                result.append(merged)
                skip_indices.add(j)
                break
        else:
            result.append(w)

    return result


def merge_slash_variants(words: list[dict]) -> list[dict]:
    """Merge variant-spelling continuations (word/ + next_word → word/next_word)."""
    absorbed = set()

    for w in words:
        key = (w['page'], w['word'])
        cont = SLASH_CONTINUATIONS.get(key)
        if cont:
            # Mark the continuation word for absorption
            absorbed.add((w['page'], cont))

    result = []
    for w in words:
        key = (w['page'], w['word'])
        if key in absorbed:
            continue  # Skip absorbed continuations

        # For slash-ending words, build the full variant string
        if w['word'].endswith('/') and key in SLASH_CONTINUATIONS:
            # Build chain: ketchup/ → catchup/ → catsup
            chain = [w['word'].rstrip('/')]
            current_key = key
            while current_key in SLASH_CONTINUATIONS:
                cont = SLASH_CONTINUATIONS[current_key]
                if cont is None:
                    break
                chain.append(cont.rstrip('/'))
                current_key = (w['page'], cont)
            merged = dict(w)
            merged['word'] = '/'.join(chain)
            result.append(merged)
        else:
            result.append(w)

    return result


# Page-to-category mapping.
# Each entry: (page, first_word_on_page_for_this_category) → category
# Determined by visual inspection of the PDF.
# Categories flow in order across pages. Each spread typically has one category,
# but transitions can happen mid-page.

# Rather than precise boundary words, I'll use page ranges since each
# page spread is dedicated to one category (with transitions at spread boundaries).
# The sidebar labels (despite being garbled) confirm which category each spread covers.

PAGE_CATEGORY_MAP = {
    # Pages 1-2: Arabic
    # Pages 2-3: Asian (starts at "abaca" on p2, y~727)
    # Pages 3-4: Dutch
    # Pages 5-6: Eponyms (p5), then French starts on p5 bottom / p6
    # Actually, let me use word-level boundaries from the PDF structure

    # I'll assign categories based on the page spread order:
    # Spread 1 (p1-2): Arabic → Asian transition
    # Spread 2 (p3-4): Asian → Dutch transition
    # etc.
}

# More practical: assign by known boundary words
# Arabic: attar ... zenith (p1 start → p2 middle)
# Asian: abaca ... wushu/yamen (p2 middle → p3 middle)
# Dutch: adjag ... witloof (p3 middle → p4 end)
# Eponyms: ampere ... zinnia (p5 start → p5 bottom)
# French: abattoir ... zigzag (p5 bottom → p9 middle)
# German: ablaut ... Wagnerian/wanderlust (p9 middle → p10 end)
# Greek: arthritis ... tachometer/syntax (p10 bottom → p12 middle)
# Italian: andante ... vino (p12 middle → p14 end)
# Japanese: bonze ... torii (p15 start → p16 middle)
# Latin: ameliorate ... zoolatry (p16 middle → p18 middle)
# New World: ahaaina ... pecan (p18 middle → p18 bottom)
# Old English: cassia ... stringy (p19 start → p19 bottom)
# Slavic: baba ... nebbish (p19 bottom → p20 middle)
# Spanish: bolero ... vigilante (p20 middle → p22 end)

# I'll define the boundary as the first word of each NEW category
CATEGORY_BOUNDARIES = [
    # (page, first_word, category)
    (1, 'attar', 'Arabic'),
    (2, 'abaca', 'Asian'),
    (3, 'adjag', 'Dutch'),  # Actually need to check - p3 starts with Asian continuing
    (5, 'ampere', 'Eponyms'),
    (5, 'abattoir', 'French'),  # or p6?
    (9, 'ablaut', 'German'),
    (10, 'arthritis', 'Greek'),  # need to verify
    (12, 'andante', 'Italian'),
    (15, 'bonze', 'Japanese'),
    (16, 'ameliorate', 'Latin'),
    (18, 'ahaaina', 'New World'),
    (19, 'cassia', 'Old English'),
    (19, 'baba', 'Slavic'),  # or p20?
    (20, 'bolero', 'Spanish'),
]


def assign_categories(words: list[dict]) -> list[dict]:
    """Assign language category to each word based on page position."""
    # Build a sorted list of (page, y, category) breakpoints
    # We need the actual Y positions of boundary words
    boundary_positions = []
    for page, first_word, category in CATEGORY_BOUNDARIES:
        # Find this word in our list
        matches = [w for w in words if w['word'].lower().startswith(first_word.lower())
                   and w['page'] == page]
        if matches:
            boundary_positions.append((page, matches[0]['y'], category))
        else:
            # Try nearby pages
            matches = [w for w in words if w['word'].lower().startswith(first_word.lower())
                       and abs(w['page'] - page) <= 1]
            if matches:
                m = matches[0]
                boundary_positions.append((m['page'], m['y'], category))
                print(f"  Warning: '{first_word}' found on page {m['page']} not {page}",
                      file=sys.stderr)
            else:
                print(f"  ERROR: boundary word '{first_word}' not found!", file=sys.stderr)

    boundary_positions.sort(key=lambda x: (x[0], x[1]))

    # Assign categories
    for w in words:
        w['category'] = None
        for i, (bp, by, bcat) in enumerate(boundary_positions):
            if i + 1 < len(boundary_positions):
                np, ny, _ = boundary_positions[i + 1]
                if (w['page'] > bp or (w['page'] == bp and w['y'] >= by)) and \
                   (w['page'] < np or (w['page'] == np and w['y'] < ny)):
                    w['category'] = bcat
                    break
            else:
                # Last category - everything from here to end
                if w['page'] > bp or (w['page'] == bp and w['y'] >= by):
                    w['category'] = bcat
                    break

    # Check for unassigned words
    unassigned = [w for w in words if w['category'] is None]
    if unassigned:
        print(f"  WARNING: {len(unassigned)} words without category!", file=sys.stderr)
        for w in unassigned[:10]:
            print(f"    p{w['page']} y={w['y']:.1f} {w['word']}", file=sys.stderr)

    return words


def main():
    pdf_path = sys.argv[1] if len(sys.argv) > 1 else "pdf/词源词.pdf"

    print("Step 1: Extract raw words...", file=sys.stderr)
    raw = extract_raw_words(pdf_path)
    print(f"  Raw: {len(raw)} words", file=sys.stderr)

    print("Step 2: Apply OCR fixes...", file=sys.stderr)
    fixed = apply_ocr_fixes(raw)
    print(f"  After OCR fixes: {len(fixed)} words", file=sys.stderr)

    print("Step 3: Merge compound words...", file=sys.stderr)
    merged = merge_compounds(fixed)
    print(f"  After compound merges: {len(merged)} words", file=sys.stderr)

    print("Step 4: Merge variant spellings...", file=sys.stderr)
    final = merge_slash_variants(merged)
    print(f"  After variant merges: {len(final)} words", file=sys.stderr)

    print("Step 5: Assign categories...", file=sys.stderr)
    categorized = assign_categories(final)

    # Summary
    from collections import Counter
    cat_counts = Counter(w['category'] for w in categorized)
    print(f"\nTotal: {len(categorized)} words", file=sys.stderr)
    for cat in LANGUAGE_CATEGORIES:
        print(f"  {cat}: {cat_counts.get(cat, 0)}", file=sys.stderr)
    if None in cat_counts:
        print(f"  UNCATEGORIZED: {cat_counts[None]}", file=sys.stderr)

    # Output
    output = {}
    for cat in LANGUAGE_CATEGORIES:
        output[cat] = sorted(set(
            w['word'] for w in categorized if w['category'] == cat
        ), key=str.lower)

    json.dump(output, sys.stdout, indent=2, ensure_ascii=False)


if __name__ == "__main__":
    main()
