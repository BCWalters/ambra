export { EpubContainer, EpubContainerError } from "./container/EpubContainer.js";
export { ZipArchive, ZipEntry, ZipFormatError, ZipIntegrityError } from "./container/ZipArchive.js";
export {
  PackageDocument,
  PackageDocumentError,
  PackageMetadata,
  ManifestItem,
  SpineItemRef,
  NCX_MEDIA_TYPE,
  parseViewportDimensions,
} from "./container/PackageDocument.js";
export type { RenditionLayout, ViewportSize } from "./container/PackageDocument.js";
export { resolveEpubPath, directoryOf, splitHrefFragment } from "./container/EpubPath.js";
export {
  NavigationDocument,
  NavigationDocumentError,
  NavigationList,
  NavPoint,
} from "./navigation/NavigationDocument.js";
export type { NavigationListType } from "./navigation/NavigationDocument.js";
export {
  ContentLoader,
  ContentDocument,
  ContentLoaderError,
  findResourceReferencesInDocument,
} from "./content/ContentLoader.js";
export type { ResourceReference } from "./content/ContentLoader.js";
export { EncryptionDocument, EncryptionDocumentError } from "./encryption/EncryptionDocument.js";
export type { EncryptedResourceEntry } from "./encryption/EncryptionDocument.js";
export {
  FontDeobfuscator,
  UnsupportedEncryptionAlgorithmError,
  IDPF_FONT_OBFUSCATION_ALGORITHM_URI,
  ADOBE_FONT_OBFUSCATION_ALGORITHM_URI,
} from "./encryption/FontDeobfuscator.js";
export { ResourceUrlResolver, ResourceResolutionError } from "./rendering/ResourceUrlResolver.js";
export { ContentDocumentAssembler } from "./rendering/ContentDocumentAssembler.js";
export { EPUB_CSS_RESET } from "./rendering/EpubCssReset.js";
export { ReadingTheme } from "./rendering/ReadingTheme.js";
export type { PageTheme, FontFamilyChoice } from "./rendering/ReadingTheme.js";
export { SandboxedContentHost, RenderingSurfaceError } from "./rendering/SandboxedContentHost.js";
export { PaginationEngine } from "./layout/PaginationEngine.js";
export { planPageBreaks } from "./layout/PaginationEngine.js";
export { Page } from "./layout/Page.js";
export type { DomBreakPoint } from "./layout/Page.js";
export { measureChunks, isBlockLevel, isLeaf, isAtomic } from "./layout/LineMeasurement.js";
export type { Chunk } from "./layout/LineMeasurement.js";
export { globalTextOffsetToPosition, totalTextLength } from "./layout/DomTextWalker.js";
export { ScrollViewEngine } from "./layout/ScrollViewEngine.js";
export { compareDomPositions, findChunkAtScrollOffset, findChunkForPosition } from "./layout/ScrollPositionTracker.js";
export { Locator, LocatorResolver, LocatorResolutionError } from "./locator/Locator.js";
export type { ResolvedLocator } from "./locator/Locator.js";
export { EpubCfi, CfiStep, EpubCfiParseError } from "./locator/EpubCfi.js";
export { AccessibilityController } from "./accessibility/AccessibilityController.js";
export { PaginatedContentHost } from "./reading/PaginatedContentHost.js";
export { ScrollContentHost } from "./reading/ScrollContentHost.js";
export { FixedContentHost } from "./reading/FixedContentHost.js";
export { SpreadPaginatedHost } from "./reading/SpreadPaginatedHost.js";
export { loadAssembledSpineItem } from "./reading/SpineItemAssembler.js";
