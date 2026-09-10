import { describe, it, expect } from 'vitest';
import {
  cleanArtifacts,
  decodeEntities,
  deriveTeaser,
  extractByline,
  htmlToText,
  isRedundantAuthor,
  stripTrailingByline,
} from '../src/text';

describe('decodeEntities', () => {
  it('decodes named and numeric entities and leaves unknown ones alone', () => {
    expect(decodeEntities('Tom &amp; Jerry &quot;live&quot;')).toBe('Tom & Jerry "live"');
    expect(decodeEntities('&#228;&#xdc;')).toBe('äÜ');
    expect(decodeEntities('&copy; unchanged')).toBe('&copy; unchanged');
  });
});

describe('htmlToText', () => {
  it('keeps paragraph structure from block tags and <br>', () => {
    expect(htmlToText('<p>First para.</p><p>Second para.</p>')).toBe('First para.\n\nSecond para.');
    expect(htmlToText('line one<br/>line two')).toBe('line one\nline two');
  });

  it('drops images and links but keeps their surrounding text', () => {
    // The shape tagesschau/NDR/MDR use for content:encoded.
    const html =
      '<p> <a href="https://example.com/a"><img src="https://img.example.com/pic.jpg" alt="alt" /></a> <br/> <br/>Story text here.[<a href="https://example.com/a">mehr</a>]</p>';
    expect(htmlToText(html)).toBe('Story text here.[mehr]');
  });

  it('collapses runs of blank lines to a single paragraph break', () => {
    expect(htmlToText('a<br/><br/><br/>b')).toBe('a\n\nb');
  });
});

describe('cleanArtifacts', () => {
  it('strips the tagesschau-style trailing [mehr] link text', () => {
    expect(cleanArtifacts('Story text here.[mehr]')).toBe('Story text here.');
    expect(cleanArtifacts('Story text here. [ mehr ]')).toBe('Story text here.');
  });

  it('strips a trailing BR-style source/timestamp parenthetical', () => {
    expect(cleanArtifacts('Die Regierung tagt. ( BR24 Radio-Nachrichten 24.08.2026 18:15)')).toBe(
      'Die Regierung tagt.'
    );
    expect(cleanArtifacts('Kurzmeldung. (BR24, 18:15 Uhr)')).toBe('Kurzmeldung.');
  });

  it('keeps an ordinary trailing parenthetical that has no time/date token', () => {
    expect(cleanArtifacts('Der FCB gewann das Finale (nach Verlängerung)')).toBe(
      'Der FCB gewann das Finale (nach Verlängerung)'
    );
  });
});

describe('deriveTeaser', () => {
  it('returns short text unchanged', () => {
    expect(deriveTeaser('A short summary.')).toBe('A short summary.');
  });

  it('cuts long text at a sentence boundary within the cap', () => {
    const sentence = 'This sentence is exactly some filler text to occupy space in the teaser. ';
    const teaser = deriveTeaser(sentence.repeat(10));
    expect(teaser.length).toBeLessThanOrEqual(320);
    expect(teaser.endsWith('teaser.')).toBe(true);
  });

  it('falls back to a word boundary for a single over-long sentence', () => {
    const teaser = deriveTeaser(`${'word '.repeat(100)}end`);
    expect(teaser.length).toBeLessThanOrEqual(321);
    expect(teaser.endsWith('…')).toBe(true);
    expect(teaser).not.toContain('  ');
  });

  it('flattens newlines so a teaser is always a single paragraph', () => {
    expect(deriveTeaser('line one\n\nline two')).toBe('line one line two');
  });
});

describe('extractByline', () => {
  it('extracts a tagesschau-style trailing byline', () => {
    expect(extractByline('Für die meisten war die Kernfrage klar. Von H. Schwesinger.')).toBe('H. Schwesinger');
    expect(extractByline('Ein Rückblick. Von Kerstin Palzer, MDR.')).toBe('Kerstin Palzer');
  });

  it('ignores prose that merely contains "Von" mid-sentence or lowercase names', () => {
    // "Von Montag an ..." is a sentence, not a byline: "an" starts lowercase.
    expect(extractByline('Das Gesetz gilt. Von Montag an.')).toBeUndefined();
    expect(extractByline('Kritik kam von der Leyen.')).toBeUndefined();
    // A summary that IS one sentence starting with "Von" has no preceding
    // sentence end, so it cannot match either.
    expect(extractByline('Von Anfang an dabei.')).toBeUndefined();
  });
});

describe('stripTrailingByline', () => {
  it('removes the trailing credit but keeps the sentence it followed', () => {
    expect(stripTrailingByline('Für die meisten war die Kernfrage klar. Von H. Schwesinger.')).toBe(
      'Für die meisten war die Kernfrage klar.'
    );
    expect(stripTrailingByline('Ein Rückblick. Von Kerstin Palzer, MDR.')).toBe('Ein Rückblick.');
  });

  it('leaves text without a trailing credit untouched', () => {
    expect(stripTrailingByline('Das Gesetz gilt. Von Montag an.')).toBe('Das Gesetz gilt. Von Montag an.');
    expect(stripTrailingByline('Kritik kam von der Leyen.')).toBe('Kritik kam von der Leyen.');
  });
});

describe('isRedundantAuthor', () => {
  it('treats the broadcaster naming itself as redundant', () => {
    expect(isRedundantAuthor('rbb24.de', 'rbb24 - Nachrichten aus Berlin und Brandenburg | rbb24', 'https://www.rbb24.de/x.html')).toBe(true);
    expect(isRedundantAuthor('WDR', 'WDR.de', 'https://www1.wdr.de/x.html')).toBe(true);
  });

  it('treats an author that embeds the source host as redundant', () => {
    expect(isRedundantAuthor('hessenschau.de, Frankfurt, Germany', 'hessenschau.de', 'https://www.hessenschau.de/x.html')).toBe(true);
  });

  it('keeps a real byline', () => {
    expect(isRedundantAuthor('H. Schwesinger', 'tagesschau.de - Die Nachrichten der ARD', 'https://www.tagesschau.de/x.html')).toBe(false);
  });

  it('rejects empty or absurdly long values', () => {
    expect(isRedundantAuthor('  ', 'Source', 'https://example.com')).toBe(true);
    expect(isRedundantAuthor('x'.repeat(61), 'Source', 'https://example.com')).toBe(true);
  });
});
