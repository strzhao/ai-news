export const WORTH_MUST_READ = "必读";
export const WORTH_WORTH_READING = "可读";
export const WORTH_SKIP = "跳过";

export type Worth = typeof WORTH_MUST_READ | typeof WORTH_WORTH_READING | typeof WORTH_SKIP;

export interface SourceConfig {
  id: string;
  name: string;
  url: string;
  sourceWeight: number;
  sourceType: string | null;
  onlyExternalLinks: boolean;
}

export interface Article {
  id: string;
  title: string;
  url: string;
  sourceId: string;
  sourceName: string;
  publishedAt: Date | null;
  summaryRaw: string;
  leadParagraph: string;
  contentText: string;
  infoUrl: string;
  tags: string[];
  primaryType: string;
  secondaryTypes: string[];
}

export interface ScoredArticle extends Article {
  score: number;
  worth: Worth;
  reasonShort: string;
}

export interface ArticleAssessment {
  articleId: string;
  worth: Worth;
  qualityScore: number;
  practicalityScore: number;
  actionabilityScore: number;
  noveltyScore: number;
  clarityScore: number;
  oneLineSummary: string;
  reasonShort: string;
  companyImpact: number;
  teamImpact: number;
  personalImpact: number;
  executionClarity: number;
  actionHint: string;
  bestForRoles: string[];
  evidenceSignals: string[];
  confidence: number;
  primaryType: string;
  secondaryTypes: string[];
  cacheKey: string;
}

export interface SourceQualityScore {
  sourceId: string;
  qualityScore: number;
  articleCount: number;
  mustReadRate: number;
  avgConfidence: number;
  freshness: number;
}

export interface TaggedArticle {
  article: ScoredArticle;
  generatedTags: string[];
}

export interface DailyDigest {
  date: string;
  timezone: string;
  topSummary: string;
  highlights: TaggedArticle[];
  dailyTags: string[];
  extras: TaggedArticle[];
}

export interface DigestRunResult {
  exitCode: number;
  reportDate: string;
  timezoneName: string;
  outputDir: string;
  reportPath: string;
  reportMarkdown: string;
  topSummary: string;
  highlightCount: number;
  hasHighlights: boolean;
  analysisPath: string;
  analysisMarkdown: string;
  analysisJson: Record<string, unknown>;
  stats: Record<string, unknown>;
}

export interface DedupeStats {
  totalInput: number;
  kept: number;
  urlDuplicates: number;
  titleDuplicates: number;
  droppedItems: Array<Record<string, string>>;
}
