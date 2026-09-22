// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { SmilDocument, SmilPar, SmilParseError, SmilSeq } from "./SmilDocument.js";

const SIMPLE_SMIL = `<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
  <body>
    <par id="par1">
      <text src="chapter1.xhtml#c01h01"/>
      <audio src="audio/c01.mp4" clipBegin="0:00:00.000" clipEnd="0:00:05.250"/>
    </par>
    <par id="par2">
      <text src="chapter1.xhtml#c01p0001"/>
      <audio src="audio/c01.mp4" clipBegin="0:00:05.250" clipEnd="0:00:58.100"/>
    </par>
  </body>
</smil>`;

const NESTED_SMIL = `<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
  <body>
    <seq id="id1" epub:textref="chapter1.xhtml#sectionstart" epub:type="chapter">
      <par id="id2">
        <text src="chapter1.xhtml#section1_title"/>
        <audio src="chapter1_audio.mp3" clipBegin="0:23:23.84" clipEnd="0:23:34.221"/>
      </par>
      <seq id="id7" epub:textref="chapter1.xhtml#figure">
        <par id="id8">
          <text src="chapter1.xhtml#photo"/>
          <audio src="chapter1_audio.mp3" clipBegin="0:24:18.123" clipEnd="0:24:28.764"/>
        </par>
        <par id="id9">
          <text src="chapter1.xhtml#caption"/>
          <audio src="chapter1_audio.mp3" clipBegin="0:24:28.764" clipEnd="0:24:50.010"/>
        </par>
      </seq>
      <par id="id12">
        <text src="chapter1.xhtml#text3"/>
        <audio src="chapter1_audio.mp3" clipBegin="0:25:45.515" clipEnd="0:26:30.203"/>
      </par>
    </seq>
  </body>
</smil>`;

describe("SmilDocument.parse", () => {
  it("parses a flat sequence of pars at the top level", () => {
    const doc = SmilDocument.parse(SIMPLE_SMIL, "OEBPS/chapter1_overlay.smil");

    expect(doc.body.children).toHaveLength(2);
    const [first, second] = doc.body.children as [SmilPar, SmilPar];
    expect(first).toBeInstanceOf(SmilPar);
    expect(first.id).toBe("par1");
    expect(first.text).toEqual({ path: "OEBPS/chapter1.xhtml", fragment: "c01h01" });
    expect(first.audio).toEqual({
      path: "OEBPS/audio/c01.mp4",
      clipBeginSeconds: 0,
      clipEndSeconds: 5.25,
    });
    expect(second.id).toBe("par2");
  });

  it("resolves text/audio src relative to the SMIL file's own directory", () => {
    const doc = SmilDocument.parse(SIMPLE_SMIL, "OEBPS/overlays/chapter1_overlay.smil");
    const [first] = doc.body.children as [SmilPar];
    expect(first.text.path).toBe("OEBPS/overlays/chapter1.xhtml");
    expect(first.audio?.path).toBe("OEBPS/overlays/audio/c01.mp4");
  });

  it("leaves clipEndSeconds undefined when the audio element omits clipEnd", () => {
    const xml = SIMPLE_SMIL.replace(' clipEnd="0:00:05.250"', "");
    const doc = SmilDocument.parse(xml, "OEBPS/chapter1_overlay.smil");
    const [first] = doc.body.children as [SmilPar];
    expect(first.audio?.clipEndSeconds).toBeUndefined();
  });

  it("parses nested seq structure, preserving epub:textref and epub:type", () => {
    const doc = SmilDocument.parse(NESTED_SMIL, "OEBPS/chapter1_overlay.smil");

    expect(doc.body.children).toHaveLength(1);
    const [topSeq] = doc.body.children as [SmilSeq];
    expect(topSeq).toBeInstanceOf(SmilSeq);
    expect(topSeq.id).toBe("id1");
    expect(topSeq.epubType).toBe("chapter");
    expect(topSeq.textref).toEqual({ path: "OEBPS/chapter1.xhtml", fragment: "sectionstart" });
    expect(topSeq.children).toHaveLength(3);

    const [par1, nestedSeq, par3] = topSeq.children as [SmilPar, SmilSeq, SmilPar];
    expect(par1.id).toBe("id2");
    expect(nestedSeq).toBeInstanceOf(SmilSeq);
    expect(nestedSeq.id).toBe("id7");
    expect(nestedSeq.children).toHaveLength(2);
    expect(par3.id).toBe("id12");
  });

  it("throws for malformed XML", () => {
    expect(() => SmilDocument.parse("<not-xml", "OEBPS/broken.smil")).toThrow(SmilParseError);
  });

  it("throws when the root element isn't <smil>", () => {
    expect(() => SmilDocument.parse("<foo/>", "OEBPS/broken.smil")).toThrow(SmilParseError);
  });

  it("throws when <body> is missing", () => {
    const xml = `<smil xmlns="http://www.w3.org/ns/SMIL" version="3.0"></smil>`;
    expect(() => SmilDocument.parse(xml, "OEBPS/broken.smil")).toThrow(SmilParseError);
  });

  it("throws when a <par> is missing its required <text> child", () => {
    const xml = `<smil xmlns="http://www.w3.org/ns/SMIL" version="3.0">
      <body><par id="p1"><audio src="a.mp3"/></par></body>
    </smil>`;
    expect(() => SmilDocument.parse(xml, "OEBPS/broken.smil")).toThrow(SmilParseError);
  });
});

describe("SmilDocument.flattenPars", () => {
  it("flattens a flat top-level sequence unchanged", () => {
    const doc = SmilDocument.parse(SIMPLE_SMIL, "OEBPS/chapter1_overlay.smil");
    const pars = doc.flattenPars();
    expect(pars.map((par) => par.id)).toEqual(["par1", "par2"]);
  });

  it("flattens nested seq structure into document order, skipping the seq nodes themselves", () => {
    const doc = SmilDocument.parse(NESTED_SMIL, "OEBPS/chapter1_overlay.smil");
    const pars = doc.flattenPars();
    expect(pars.map((par) => par.id)).toEqual(["id2", "id8", "id9", "id12"]);
  });
});
