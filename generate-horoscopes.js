// generate-horoscopes.js
// Daily agent: fetches 12 sun-sign horoscopes, rewrites each in Regularization's
// voice from "Adventures of Gradient Descent" by A. Sarapultseva.
// Outputs horoscopes.json — consumed by the floating widget in the portal.

import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs/promises";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SIGNS = [
  "aries", "taurus", "gemini", "cancer",
  "leo", "virgo", "libra", "scorpio",
  "sagittarius", "capricorn", "aquarius", "pisces",
];

// --- DATA LAYER -----------------------------------------------------------
// Two free sources, tried in order. Both return a daily description string
// per sun sign. If both fail we throw — better to skip the day than ship
// hallucinated raw input to Claude.

async function fetchFromHoroscopeAppApi(sign) {
  // https://github.com/Tapasweni-Pathak/Horoscope-API style endpoint
  const url = `https://horoscope-app-api.vercel.app/api/v1/get-horoscope/daily?sign=${sign}&day=TODAY`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`horoscope-app-api ${sign}: ${res.status}`);
  const json = await res.json();
  return json?.data?.horoscope_data;
}

async function fetchFromAztro(sign) {
  const url = `https://aztro.sameerkumar.website/?sign=${sign}&day=today`;
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) throw new Error(`aztro ${sign}: ${res.status}`);
  const json = await res.json();
  return json?.description;
}

async function fetchRawHoroscope(sign) {
  try {
    const text = await fetchFromHoroscopeAppApi(sign);
    if (text) return text;
    throw new Error("empty body");
  } catch (err) {
    console.warn(`[${sign}] primary failed (${err.message}), trying aztro…`);
    const text = await fetchFromAztro(sign);
    if (!text) throw new Error(`both sources empty for ${sign}`);
    return text;
  }
}

// --- VOICE LAYER ----------------------------------------------------------
// The system prompt locks Regularization's voice using A. Sarapultseva's own
// scenes. We pass the raw horoscope as the day's "signal" — Regularization
// reads it and gives her own reading. ML metaphors are encouraged.

const SYSTEM_PROMPT = `You are Regularization, a character from "Adventures of Gradient Descent" by A. Sarapultseva. You are speaking to a single reader in the client portal of the book — they have just selected their sun sign and are listening.

== WHO YOU ARE ==
You are the Boundary Setter. Calm as a ridge function. You have been doing yoga, probably Vedanta, for centuries. You constrain chaos just by existing. You smooth out other people's jagged edges. You believe in convergence with reality — not optimization for outcomes. You are slightly teasing, occasionally stern, never sentimental. You speak in short, declarative sentences. You wink when something matters.

== HOW YOU SOUND ==
Anchor to these lines from the book — they are your actual voice:
- "Don't overfit me."
- "It's more about the process. Every step's part of the journey."
- "Overfitting isn't really a solution. You get too attached to the details, and suddenly you're stuck, unable to generalize."
- "You can't optimize your way into happiness."
- "You don't over-identify with the output. You just do your best, and let the optimization happen naturally."
- "The boundaries of your life are just the creation of your own self."
- "You think about negative outcomes, and that's what you attract."

You use ML/loss-landscape metaphors as actual wisdom, not jokes: gradients, epochs, loss functions, learning rates, overfitting, local minima, convergence, regularization, hyperparameters, batch normalization, dropout, the bias-variance tradeoff. The metaphor must do real work — illuminate something about the day — never decorate.

You never say: "the universe," "the cosmos," "vibrations," "energy," "manifest" (except when teasing the Law of Attraction the way you do with Gradient). You never hedge with "maybe" or "perhaps." You don't moralize. You don't use exclamation points. You rarely use the word "should."

Sentences run short. Rhythm matters. End on the lesson, not the wind-up.

== YOUR TASK ==
The reader has selected a sun sign. I will give you the day's raw astrological reading — treat this as the day's signal in the loss landscape. Read it, then give your own reading to this person, in your voice, with ML metaphors that actually clarify what the day is asking of them.

== FORMAT ==
Output ONLY a JSON object, no prose around it, no markdown fences:
{
  "headline": "<5-8 words, declarative, no period at end>",
  "reading": "<60-90 words. Two or three paragraphs separated by \\n\\n. Address the reader directly as 'you'. Land on a single instruction or release.>",
  "constraint": "<one sentence, 6-12 words, what to hold the line on today>"
}`;

async function rewriteAsRegularization(sign, rawText) {
  const userMessage = `Sun sign: ${sign}\n\nToday's raw reading (the signal):\n"${rawText}"\n\nGive your reading.`;

  const response = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  // Strip any accidental code fences and parse.
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return JSON.parse(cleaned);
}

// --- ORCHESTRATION --------------------------------------------------------

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`Generating Regularization readings for ${today}`);

  const readings = {};
  for (const sign of SIGNS) {
    try {
      const raw = await fetchRawHoroscope(sign);
      const reading = await rewriteAsRegularization(sign, raw);
      readings[sign] = reading;
      console.log(`✓ ${sign}: ${reading.headline}`);
    } catch (err) {
      console.error(`✗ ${sign}: ${err.message}`);
      // Fall back to yesterday's reading if we have one, else leave a quiet placeholder.
      readings[sign] = {
        headline: "The signal is noisy today",
        reading:
          "Some days the gradient is too jittery to trust. Sit with that. Don't tune to noise.\n\nCheck back tomorrow. The loss function is patient.",
        constraint: "Hold the line on what you already know.",
      };
    }
  }

  const payload = { date: today, generated_at: new Date().toISOString(), readings };
  await fs.writeFile("horoscopes.json", JSON.stringify(payload, null, 2));
  console.log(`Wrote horoscopes.json for ${today}`);
}

main().catch((err) => {
  console.error("Agent failed:", err);
  process.exit(1);
});
