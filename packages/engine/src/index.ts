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
export type { RenditionLayout, ViewportSize, BookIdentifier, OpfMetaEntry, AccessibilityMetadata } from "./container/PackageDocument.js";
export type { PackageMetadataOptions } from "./container/PackageDocument.js";
export type {
  RenditionSpread,
  RenditionOrientation,
  PageProgressionDirection,
  PageSpreadSide,
} from "./container/PackageDocument.js";
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
export { findTextMatchesInDocument } from "./content/DocumentTextSearch.js";
export type { DocumentTextMatch } from "./content/DocumentTextSearch.js";
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
export { ReadingTheme, defaultFontFamilyForPlatform } from "./rendering/ReadingTheme.js";
export type { PageTheme, FontFamilyChoice } from "./rendering/ReadingTheme.js";
export { HighlightTheme } from "./rendering/HighlightTheme.js";
export type { HighlightStyle } from "./rendering/HighlightTheme.js";
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
export {
  parseAnnotationCollection,
  serializeAnnotationCollection,
  AnnotationParseError,
  EPUB_CFI_CONFORMS_TO,
} from "./annotations/EpubAnnotation.js";
export type {
  EpubAnnotation,
  AnnotationMotivation,
  AnnotationCreator,
  AnnotationTarget,
  AnnotationBody,
  AnnotationSelector,
  FragmentSelector,
  CssSelector,
  TextPositionSelector,
} from "./annotations/EpubAnnotation.js";
export { AccessibilityController } from "./accessibility/AccessibilityController.js";
export { parseSmilClockValue, SmilClockValueError } from "./media-overlay/SmilClockValue.js";
export { SmilDocument, SmilPar, SmilSeq, SmilParseError } from "./media-overlay/SmilDocument.js";
export type { SmilNode, SmilTextRef, SmilAudioClip } from "./media-overlay/SmilDocument.js";
export { MediaOverlayPlayer, MediaOverlayError } from "./media-overlay/MediaOverlayPlayer.js";
export type { MediaOverlayAudioHost, MediaOverlayClip } from "./media-overlay/MediaOverlayPlayer.js";
export { PaginatedContentHost } from "./reading/PaginatedContentHost.js";
export { ScrollContentHost } from "./reading/ScrollContentHost.js";
export { FixedContentHost } from "./reading/FixedContentHost.js";
export { SpreadPaginatedHost } from "./reading/SpreadPaginatedHost.js";
export { ReflowableSpreadPlanner } from "./reading/ReflowableSpreadPlanner.js";
export type { ReflowablePagePosition, ReflowableSpread } from "./reading/ReflowableSpreadPlanner.js";
export { FixedSpreadHost } from "./reading/FixedSpreadHost.js";
export { FixedLayoutSpreadPlanner } from "./reading/FixedLayoutSpreadPlanner.js";
export type { FixedSpread } from "./reading/FixedLayoutSpreadPlanner.js";
export { loadAssembledSpineItem } from "./reading/SpineItemAssembler.js";
export { BookPaginationEstimator } from "./reading/BookPaginationEstimator.js";
export type { BookPosition } from "./reading/BookPaginationEstimator.js";
export { BookSearch, MIN_QUERY_LENGTH } from "./reading/BookSearch.js";
export type { SearchResult } from "./reading/BookSearch.js";
export { computePriorityOrder, aggregateBookPosition, resolveGlobalPage } from "./reading/BookPagination.js";
export { DisclosureState } from "./reading/DisclosureState.js";
export type { ContentDocumentView } from "./reading/ContentDocumentView.js";
