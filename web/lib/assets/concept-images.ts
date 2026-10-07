// An asset's concept images live in one list, assets.reference_images. The first entry is the main
// concept image, which the site and the board's card cover use; the rest are secondary concept
// images. The New Asset and Edit forms hold that list as text, one link per line, and these helpers
// treat its first line as the main image and the lines after it as the secondary ones.
//
// The first line stays the main image even while it's blank, so clearing the main image's link
// box doesn't pull a secondary image into it mid-edit. Saving drops blank lines
// (toFileStoreEntries), so an asset saved without a main image has its first secondary image first.

const lineList = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/**
 * Input: the form's reference text.
 * Output: its first line (the main concept image) and the rest of the text as typed.
 */
export function splitConceptImages(value: string): { main: string; secondaryText: string } {
  const breakAt = value.indexOf("\n");
  return breakAt === -1 ? { main: value, secondaryText: "" } : { main: value.slice(0, breakAt), secondaryText: value.slice(breakAt + 1) };
}

/** Rebuilds the form's reference text with the main concept image on the first line. */
export function joinConceptImages(main: string, secondaryText: string): string {
  return secondaryText ? `${main}\n${secondaryText}` : main;
}

/**
 * Makes `url` the main concept image. The previous main one becomes the first secondary image, so
 * replacing the main image never drops a file. A `url` already in the list moves rather than repeats.
 *
 * Input: the form's reference text and the new main image's link. Output: the new text.
 */
export function setMainConceptImage(value: string, url: string): string {
  const { main, secondaryText } = splitConceptImages(value);
  const rest = lineList(`${main}\n${secondaryText}`).filter((line) => line !== url.trim());
  return [url.trim(), ...rest].join("\n");
}

/** Adds links after the secondary concept images, keeping the main image where it is. */
export function addSecondaryConceptImages(value: string, urls: string[]): string {
  const { main, secondaryText } = splitConceptImages(value);
  return joinConceptImages(main, [...lineList(secondaryText), ...urls].join("\n"));
}

/** Removes the secondary concept image on exactly this line, keeping the main image where it is. */
export function removeSecondaryConceptImage(value: string, url: string): string {
  const { main, secondaryText } = splitConceptImages(value);
  return joinConceptImages(main, lineList(secondaryText).filter((line) => line !== url).join("\n"));
}
