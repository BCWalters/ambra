// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { describe, expect, it } from "vitest";
import { EncryptionDocument, EncryptionDocumentError } from "./EncryptionDocument.js";

async function loadFixtureText(name: string): Promise<string> {
  const buffer = await readFile(
    fileURLToPath(new NodeURL(`../../test/fixtures/${name}`, import.meta.url)),
  );
  return buffer.toString("utf-8");
}

describe("EncryptionDocument", () => {
  it("parses each <EncryptedData> entry's resource path and algorithm URI", async () => {
    const xml = await loadFixtureText("font-obfuscation-epub-src/META-INF/encryption.xml");

    const doc = EncryptionDocument.parse(xml);

    expect(doc.entries).toHaveLength(2);
    expect(doc.getEntry("OEBPS/fonts/idpf-obfuscated.otf")?.algorithmUri).toBe(
      "http://www.idpf.org/2008/embedding",
    );
    expect(doc.getEntry("OEBPS/fonts/adobe-obfuscated.otf")?.algorithmUri).toBe(
      "http://ns.adobe.com/pdf/enc#RC",
    );
  });

  it("returns undefined for a path with no encryption entry", async () => {
    const xml = await loadFixtureText("font-obfuscation-epub-src/META-INF/encryption.xml");

    const doc = EncryptionDocument.parse(xml);

    expect(doc.getEntry("OEBPS/ch1.xhtml")).toBeUndefined();
  });

  it("throws EncryptionDocumentError when the root element isn't <encryption>", () => {
    const xml = `<?xml version="1.0"?><not-encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"/>`;

    expect(() => EncryptionDocument.parse(xml)).toThrow(EncryptionDocumentError);
  });

  it("throws EncryptionDocumentError when an EncryptedData is missing EncryptionMethod", () => {
    const xml = `<?xml version="1.0"?>
      <encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#">
          <CipherData><CipherReference URI="OEBPS/fonts/x.otf"/></CipherData>
        </EncryptedData>
      </encryption>`;

    expect(() => EncryptionDocument.parse(xml)).toThrow(EncryptionDocumentError);
  });

  it("throws EncryptionDocumentError when an EncryptedData is missing CipherReference", () => {
    const xml = `<?xml version="1.0"?>
      <encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#">
          <EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/>
        </EncryptedData>
      </encryption>`;

    expect(() => EncryptionDocument.parse(xml)).toThrow(EncryptionDocumentError);
  });
});
