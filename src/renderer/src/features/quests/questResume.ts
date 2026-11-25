// questResume.ts — come BACK from the map to the quest page you left (quest locations wave).
//
// A location chip on a quest page opens the Maps tab, and the Quests tab unmounts on the way (the
// JOS-90 law), so its open page — plain `useState` — is gone by the time you return. Without this,
// "click the chip, look at the map, press Back" lands on the quest LIST, which is the one place
// you did not come from. The chip remembers its page here; the next Quests mount reads it and then
// retires it. Session-lifetime and one-shot on purpose: it answers one round trip, not "reopen
// whatever I last read", which would be a different feature with a different argument.

let resume: string | null = null

/** A chip on `page` is about to leave for the Maps tab. */
export function rememberQuestPage(page: string): void {
  resume = page
}

/** The page to reopen, if a chip left from one. A pure read: a state initializer may call it twice. */
export function peekQuestPage(): string | null {
  return resume
}

/** The mount that reopened it is done with it. */
export function forgetQuestPage(): void {
  resume = null
}
