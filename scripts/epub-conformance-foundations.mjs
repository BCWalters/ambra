const kinds = {
  "nav-access": "navigation",
  "nav-activation": "navigation",
  "pkg-title-order": "package",
  "pkg-creator-order": "package",
  "pkg-meta-whitespace": "package",
  "pkg-dir_creator-rtl": "package",
  "pkg-dir_but_not_content": "package",
  "pkg-lang_but_not_content": "package",
  "lay-roll-embedded-images": "roll",
  "lay-roll-embedded-images-svg": "roll",
};
const nullableText = (value) => value === null || typeof value === "string";
const texts = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const canonical = (value) =>
  value.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "").replace(/[\t\n\f\r ]+/g, " ");

export function isFoundationId(value) {
  return typeof value === "string" && Object.hasOwn(kinds, value);
}

export function isFoundationCriterion(value) {
  return (
    !!value &&
    typeof value.id === "string" &&
    isFoundationId(value.id) &&
    value.kind === kinds[value.id]
  );
}

function requireShape(valid, id) {
  if (!valid) throw new Error(`${id} has malformed native foundation measurements.`);
}

function renderedText(value) {
  return (
    value === null ||
    (!!value &&
      typeof value.text === "string" &&
      nullableText(value.lang) &&
      nullableText(value.dir) &&
      ["ltr", "rtl"].includes(value.direction) &&
      typeof value.painted === "boolean")
  );
}

export function rollImageHitPoint({ frame, image, clip, viewport, clientWidth, clientHeight }) {
  const rectangle = (value) => value && [value.x, value.y, value.width, value.height].every(finite) &&
    value.width >= 0 && value.height >= 0;
  if (![frame, image, clip].every(rectangle) || !viewport ||
    ![viewport.width, viewport.height, clientWidth, clientHeight].every(finite) ||
    viewport.width <= 0 || viewport.height <= 0 || clientWidth <= 0 || clientHeight <= 0)
    throw new Error("Invalid native roll paint geometry.");
  if (frame.width === 0 || frame.height === 0) return null;
  const scaleX = frame.width / clientWidth;
  const scaleY = frame.height / clientHeight;
  const left = Math.max(0, clip.x, frame.x, frame.x + image.x * scaleX);
  const right = Math.min(viewport.width, clip.x + clip.width, frame.x + frame.width,
    frame.x + (image.x + image.width) * scaleX);
  const top = Math.max(0, clip.y, frame.y, frame.y + image.y * scaleY);
  const bottom = Math.min(viewport.height, clip.y + clip.height, frame.y + frame.height,
    frame.y + (image.y + image.height) * scaleY);
  if (right <= left || bottom <= top) return null;
  const x = (left + right) / 2;
  const y = (top + bottom) / 2;
  return {
    viewport: { x, y },
    document: { x: (x - frame.x) / scaleX, y: (y - frame.y) / scaleY },
  };
}

export function foundationVerdict(observations, criterion) {
  if (!isFoundationCriterion(criterion)) throw new Error("Unknown foundation criterion.");
  const { id, kind } = criterion;
  requireShape(observations?.kind === kind, id);
  if (kind === "package") {
    const { source, rendered, content } = observations;
    requireShape(
      source &&
        texts(source.titles) &&
        source.titles.length > 0 &&
        source.titles.every((value) => canonical(value).length > 0) &&
        texts(source.creators) &&
        source.creators.every((value) => canonical(value).length > 0) &&
        nullableText(source.dir) &&
        nullableText(source.lang) &&
        nullableText(source.creatorDir) &&
        digest(source.contentDigest) &&
        typeof source.contentUnannotated === "boolean" &&
        rendered &&
        renderedText(rendered.title) &&
        renderedText(rendered.creator) &&
        content &&
        ["htmlLang", "xmlLang", "bodyLang", "frameLang"].every((key) =>
          nullableText(content[key]),
        ) &&
        ["ltr", "rtl"].includes(content.direction) &&
        texts(content.languages) &&
        typeof content.locale === "string",
      id,
    );
    const title = rendered.title;
    const creator = rendered.creator;
    if (!title?.painted || title.text !== canonical(source.titles[0])) return false;
    if (id === "pkg-title-order") {
      requireShape(source.titles.length >= 2, id);
      return true;
    }
    if (
      id === "pkg-creator-order" ||
      id === "pkg-meta-whitespace" ||
      id === "pkg-dir_creator-rtl"
    ) {
      requireShape(source.creators.length > 0, id);
      if (!creator?.painted || creator.text !== canonical(source.creators[0])) return false;
      if (id === "pkg-creator-order") {
        requireShape(source.creators.length >= 2, id);
        return true;
      }
      if (id === "pkg-meta-whitespace") {
        requireShape(
          source.titles[0] !== canonical(source.titles[0]) ||
            source.creators[0] !== canonical(source.creators[0]),
          id,
        );
        return true;
      }
      requireShape(source.creatorDir === "rtl", id);
      return creator.dir === "rtl" && creator.direction === "rtl";
    }
    requireShape(digest(content.sha256) && typeof content.painted === "boolean", id);
    const languages = [
      content.htmlLang,
      content.xmlLang,
      content.bodyLang,
      content.frameLang,
      ...content.languages,
    ];
    if (id === "pkg-dir_but_not_content") {
      requireShape(source.dir === "rtl" && source.lang === "he" && source.contentUnannotated, id);
      return (
        content.painted &&
        content.sha256 === source.contentDigest &&
        content.direction === "ltr" &&
        languages.every((value) => value === null || !/^he(?:-|$)/i.test(value))
      );
    }
    requireShape(source.lang === "fr" && source.contentUnannotated, id);
    const explicit = languages.filter((value) => value !== null && value !== "");
    return (
      content.painted &&
      content.sha256 === source.contentDigest &&
      explicit.every((value) => /^en(?:-|$)/i.test(value)) &&
      /^en(?:-|$)/i.test(content.locale)
    );
  }
  if (kind === "navigation") {
    const { source, controls, activations } = observations;
    requireShape(
      Array.isArray(source) &&
        source.length > 0 &&
        source.every(
          (link) =>
            typeof link?.label === "string" &&
            link.label.length > 0 &&
            typeof link.path === "string" &&
            nullableText(link.fragment) &&
            nullableText(link.title) &&
            typeof link.text === "string" &&
            Number.isSafeInteger(link.spineIndex) &&
            link.spineIndex >= 0,
        ) &&
        controls &&
        typeof controls.available === "boolean" &&
        typeof controls.painted === "boolean" &&
        texts(controls.labels) &&
        Array.isArray(activations),
      id,
    );
    const accessible =
      controls.available &&
      controls.painted &&
      source.every((link) => controls.labels.includes(link.label));
    if (id === "nav-access") {
      requireShape(activations.length === 0, id);
      return accessible;
    }
    requireShape(
      activations.length === source.length &&
        activations.every(
          (item) =>
            typeof item?.path === "string" &&
            nullableText(item.title) &&
            typeof item.text === "string" &&
            Number.isSafeInteger(item.spineIndex) &&
            typeof item.found === "boolean" &&
            typeof item.painted === "boolean",
        ),
      id,
    );
    return (
      accessible &&
      activations.every(
        (item, index) =>
          item.path === source[index].path &&
          item.spineIndex === source[index].spineIndex &&
          item.title === source[index].title &&
          item.text === source[index].text &&
          item.found &&
          item.painted,
      )
    );
  }
  const { source, viewportWidth, frames } = observations;
  requireShape(
    Array.isArray(source) &&
      source.length > 0 &&
      source.every(
        (item) =>
          finite(item?.width) &&
          item.width > 0 &&
          finite(item.height) &&
          item.height > 0 &&
          Array.isArray(item.images) &&
          item.images.length > 0 &&
          item.images.every(digest),
      ) &&
      finite(viewportWidth) &&
      viewportWidth >= 0 &&
      Array.isArray(frames) &&
      frames.every(
        (frame) =>
          ["x", "y", "width", "height"].every((key) => finite(frame?.[key])) &&
          frame.width >= 0 &&
          frame.height >= 0 &&
          Array.isArray(frame.images) &&
          frame.images.every(
            (image) =>
              image &&
              nullableText(image.sha256) &&
              (image.sha256 === null || digest(image.sha256)) &&
              typeof image.painted === "boolean" &&
              typeof image.packaged === "boolean" &&
              Number.isSafeInteger(image.width) &&
              image.width >= 0 &&
              Number.isSafeInteger(image.height) &&
              image.height >= 0 &&
              nullableText(image.error),
          ),
      ),
    id,
  );
  if (viewportWidth <= 0 || frames.length !== source.length) return false;
  return frames.every(
    (frame, index) =>
      Math.abs(frame.width - viewportWidth) <= 1 &&
      Math.abs(frame.height - (viewportWidth * source[index].height) / source[index].width) <= 1 &&
      Math.abs(frame.x - frames[0].x) <= 1 &&
      (index === 0 || Math.abs(frame.y - frames[index - 1].y - frames[index - 1].height) <= 1) &&
      frame.images.length === source[index].images.length &&
      frame.images.every(
        (image, ordinal) =>
          image.packaged &&
          image.painted &&
          image.width > 0 &&
          image.height > 0 &&
          image.error === null &&
          image.sha256 === source[index].images[ordinal],
      ),
  );
}
