/**
 * Générateurs de fichiers de test.
 *
 * Les tests s'appuient sur de véritables fichiers PDF, DOCX et DICOM plutôt
 * que sur des extracteurs simulés : c'est le seul moyen de vérifier que la
 * chaîne d'import fonctionne réellement de bout en bout.
 */
import JSZip from 'jszip';

/** Construit un PDF minimal mais valide contenant les lignes fournies. */
export function makePdf(lines: string[]): Buffer {
  const escape = (s: string) => s.replace(/([()\\])/g, '\\$1');
  const body = lines
    .map((line, i) => `BT /F1 12 Tf 50 ${740 - i * 18} Td (${escape(line)}) Tj ET`)
    .join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R ' +
      '/Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    // Sans encodage déclaré, les octets > 127 sont lus selon l'encodage
    // standard PDF et « é » ressort en « Ø ». WinAnsi correspond au latin1
    // utilisé pour sérialiser le flux.
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

/** Construit un .docx contenant les paragraphes fournis. */
export async function makeDocx(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip();

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );

  zip.folder('_rels')!.file(
    '.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );

  const escapeXml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const paras = paragraphs
    .map((p) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(p)}</w:t></w:r></w:p>`)
    .join('');

  zip.folder('word')!.file(
    'document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${paras}</w:body>
</w:document>`,
  );

  return zip.generateAsync({ type: 'nodebuffer' });
}

/** Construit un .docx dont le contenu est un tableau « libellé | valeur ». */
export async function makeDocxTable(rows: [string, string][]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.folder('_rels')!.file(
    '.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );

  const escapeXml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const cell = (t: string) =>
    `<w:tc><w:p><w:r><w:t xml:space="preserve">${escapeXml(t)}</w:t></w:r></w:p></w:tc>`;
  const body = rows.map(([k, v]) => `<w:tr>${cell(k)}${cell(v)}</w:tr>`).join('');

  zip.folder('word')!.file(
    'document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:tbl>${body}</w:tbl></w:body>
</w:document>`,
  );

  return zip.generateAsync({ type: 'nodebuffer' });
}

// --------------------------------------------------------------------- DICOM

/** VR dont la longueur est codée sur 2 octets (forme courte, VR explicite). */
const SHORT_VR = new Set(['AE', 'AS', 'AT', 'CS', 'DA', 'DS', 'DT', 'FL', 'FD',
  'IS', 'LO', 'LT', 'PN', 'SH', 'SL', 'SS', 'ST', 'TM', 'UI', 'UL', 'US']);

function dicomElement(group: number, element: number, vr: string, value: string): Buffer {
  // Les chaînes DICOM sont de longueur paire (complétées par un espace ou \0).
  const padded = value.length % 2 === 0 ? value : value + (vr === 'UI' ? '\0' : ' ');
  const data = Buffer.from(padded, 'latin1');

  const header = Buffer.alloc(SHORT_VR.has(vr) ? 8 : 12);
  header.writeUInt16LE(group, 0);
  header.writeUInt16LE(element, 2);
  header.write(vr, 4, 'latin1');
  if (SHORT_VR.has(vr)) {
    header.writeUInt16LE(data.length, 6);
  } else {
    header.writeUInt16LE(0, 6);
    header.writeUInt32LE(data.length, 8);
  }
  return Buffer.concat([header, data]);
}

export interface DicomFixture {
  patientName?: string;
  patientId?: string;
  patientAge?: string;
  patientSex?: string;
  studyDate?: string;
  modality?: string;
  studyDescription?: string;
}

/** Construit un fichier DICOM Part-10 valide, VR explicite little-endian. */
export function makeDicom(fields: DicomFixture = {}): Buffer {
  const {
    patientName = 'TEST^Patient',
    patientId = 'P-0001',
    patientAge = '054Y',
    patientSex = 'M',
    studyDate = '20240315',
    modality = 'CT',
    studyDescription = 'TDM abdominale',
  } = fields;

  // Méta-informations (groupe 0002), toujours en VR explicite little-endian.
  const transferSyntax = dicomElement(0x0002, 0x0010, 'UI', '1.2.840.10008.1.2.1');
  const sopClass = dicomElement(0x0002, 0x0002, 'UI', '1.2.840.10008.5.1.4.1.1.2');
  const sopInstance = dicomElement(0x0002, 0x0003, 'UI', '1.2.3.4.5.6.7.8');
  const metaPayload = Buffer.concat([sopClass, sopInstance, transferSyntax]);

  // (0002,0000) FileMetaInformationGroupLength : UL de 4 octets donnant la
  // taille du reste du groupe 0002.
  const groupLength = Buffer.alloc(12);
  groupLength.writeUInt16LE(0x0002, 0);
  groupLength.writeUInt16LE(0x0000, 2);
  groupLength.write('UL', 4, 'latin1');
  groupLength.writeUInt16LE(4, 6);
  groupLength.writeUInt32LE(metaPayload.length, 8);

  const dataset = Buffer.concat([
    dicomElement(0x0008, 0x0020, 'DA', studyDate),
    dicomElement(0x0008, 0x0060, 'CS', modality),
    dicomElement(0x0008, 0x1030, 'LO', studyDescription),
    dicomElement(0x0010, 0x0010, 'PN', patientName),
    dicomElement(0x0010, 0x0020, 'LO', patientId),
    dicomElement(0x0010, 0x0040, 'CS', patientSex),
    dicomElement(0x0010, 0x1010, 'AS', patientAge),
  ]);

  const preamble = Buffer.alloc(128, 0);
  return Buffer.concat([
    preamble,
    Buffer.from('DICM', 'latin1'),
    groupLength,
    metaPayload,
    dataset,
  ]);
}
