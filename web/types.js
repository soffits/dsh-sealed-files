/**
 * Media types by file extension, for files whose type wasn't given (put by the assistant, or a browser that sent
 * none). A phone's share sheet picks its apps by this type (Photos for an image, players for a video). It does
 * not bring up Books or reader apps for a book: WebKit hands a web page's shared file over as data, not as a file,
 * and those apps take files only; a book reaches them through Save to Files.
 */
const BY_EXTENSION = {
  epub: 'application/epub+zip', pdf: 'application/pdf', mobi: 'application/x-mobipocket-ebook', azw3: 'application/vnd.amazon.ebook', fb2: 'application/x-fictionbook+xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/ogg',
  txt: 'text/plain', md: 'text/markdown', json: 'application/json', csv: 'text/csv', html: 'text/html', srt: 'text/plain', ass: 'text/plain',
  zip: 'application/zip', '7z': 'application/x-7z-compressed', rar: 'application/vnd.rar', gz: 'application/gzip', tar: 'application/x-tar',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pages: 'application/vnd.apple.pages', numbers: 'application/vnd.apple.numbers', key: 'application/vnd.apple.keynote',
}
const GENERIC = 'application/octet-stream'

export const typeByName = name => BY_EXTENSION[/\.([a-z0-9]+)$/i.exec(name ?? '')?.[1]?.toLowerCase() ?? ''] ?? GENERIC

/** The type to use for a file: the one stored, unless it says nothing, then the one its name gives. */
export function typeOf(name, stored = '') {
  const base = String(stored).split(';')[0].trim()
  return base && base !== GENERIC ? base : typeByName(name)
}
