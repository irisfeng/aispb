import { NextResponse } from "next/server";

import { lookupMerriamWebsterWord } from "@/lib/merriam-webster";
import { wordBank } from "@/lib/word-bank";
import { wordBankHigh } from "@/lib/word-bank-high";
import { wordBankEtymology } from "@/lib/word-bank-etymology";

function findLocalWord(query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const allBanks = [...wordBank, ...wordBankHigh, ...wordBankEtymology];

  return (
    allBanks.find((word) => word.word.toLowerCase() === normalizedQuery) ??
    allBanks.find((word) => word.id.toLowerCase() === normalizedQuery) ??
    null
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const wordQuery = searchParams.get("word");

  if (!wordQuery) {
    return NextResponse.json(
      { error: "Missing word query parameter." },
      { status: 400 },
    );
  }

  const localWord = findLocalWord(wordQuery);

  if (!localWord) {
    return NextResponse.json({ error: "Word not found." }, { status: 404 });
  }

  try {
    const remoteEntry = await lookupMerriamWebsterWord(localWord.word);

    if (remoteEntry) {
      return NextResponse.json({
        word: localWord.word,
        definition: remoteEntry.definition ?? localWord.definition,
        sentence: remoteEntry.sentence ?? localWord.sentence,
        origin: remoteEntry.origin ?? localWord.origin,
        phonetic: remoteEntry.phonetic ?? localWord.phonetic,
        partOfSpeech: remoteEntry.partOfSpeech,
        provider: remoteEntry.provider,
        fallback: false,
      });
    }
  } catch (error) {
    console.error("dictionary lookup fallback", error);
  }

  return NextResponse.json({
    word: localWord.word,
    definition: localWord.definition,
    sentence: localWord.sentence,
    origin: localWord.origin,
    phonetic: localWord.phonetic,
    partOfSpeech: null,
    provider: "Local seed dictionary",
    fallback: true,
  });
}
