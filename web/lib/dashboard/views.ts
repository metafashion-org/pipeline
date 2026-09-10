import { cachedView, CACHE_TAGS } from "@/lib/cache/tags";
import { getReadyForUploadQueue } from "@/lib/publisher/publisher-service";
import { getKnowledgeArtifacts, listArtifactTypes } from "@/lib/knowledge/artifacts-service";
import { getMarketingKanbanData } from "@/lib/marketing/marketing-kanban-service";
import { getCurationFormFields } from "@/lib/curation/curation-service";
import { listForms, type FormSummary } from "@/lib/forms/form-builder-service";
import { normalizeFieldOptions, type FieldOption } from "@/lib/forms/field-options";

// The read side of the dashboard's main views, cached under the tags in lib/cache/tags.ts.
//
// Each loader returns exactly the props its page passes to a client component, with dates already
// as ISO strings. That is not cosmetic: the Next.js data cache stores values as JSON, so a Date
// put in comes back out as a string, and a page that then called .toISOString() on it would throw.
// Serialising inside the cached loader keeps the shape the same on a hit and a miss.
//
// A write invalidates its tag (see the revalidateTag calls in the API routes), so a cached view is
// normally correct the moment the underlying rows change. The revalidate window in tags.ts is only
// the fallback for a change this app did not make.

export interface PublisherQueueItemView {
  id: string;
  sku: string;
  itemName: string;
  category: string | null;
  deadline: string | null;
  artistName: string | null;
  updatedAt: string;
}

export const getPublisherQueueView = cachedView(
  async (): Promise<PublisherQueueItemView[]> => {
    const queue = await getReadyForUploadQueue();
    return queue.map((item) => ({
      ...item,
      deadline: item.deadline ? item.deadline.toISOString() : null,
      updatedAt: item.updatedAt.toISOString(),
    }));
  },
  ["publisher-queue-view"],
  [CACHE_TAGS.publisherQueue]
);

export interface KnowledgeRegistryView {
  artifacts: Array<{
    id: string;
    artifactId: string;
    title: string;
    description: string | null;
    source: string | null;
    fileUrl: string | null;
    tags: string[] | null;
    usageNotes: string | null;
    createdAt: string;
    typeLabel: string;
    typePrefix: string;
  }>;
  types: Array<{ id: string; prefix: string; label: string }>;
}

export const getKnowledgeRegistryView = cachedView(
  async (): Promise<KnowledgeRegistryView> => {
    const [artifacts, types] = await Promise.all([getKnowledgeArtifacts(), listArtifactTypes()]);
    return {
      artifacts: artifacts.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
      types: types.map((t) => ({ id: t.id, prefix: t.prefix, label: t.label })),
    };
  },
  ["knowledge-registry-view"],
  [CACHE_TAGS.knowledge]
);

export interface MarketingView {
  statusColumns: Array<{ id: string; statusKey: string; label: string }>;
  updates: Array<{
    updateId: string;
    assetId: string;
    sku: string;
    itemName: string;
    campaign: string | null;
    platform: string;
    postType: string | null;
    postUrl: string | null;
    creative: string | null;
    caption: string | null;
    marketingStatus: string;
    postedAt: string | null;
    highPerforming: boolean;
    notes: string | null;
    nextAction: string | null;
    createdAt: string;
  }>;
  unmarketedAssets: Array<{
    id: string;
    sku: string;
    itemName: string;
    category: string | null;
    currentStatus: string;
  }>;
}

const EMPTY_MARKETING_VIEW: MarketingView = { statusColumns: [], updates: [], unmarketedAssets: [] };

export const getMarketingView = cachedView(
  async (): Promise<MarketingView> => {
    // The page has always rendered an empty board rather than an error page when this query fails,
    // and that behaviour is kept here. An empty result is not written to the cache, though — caching
    // a failure would keep the board empty for the whole revalidate window instead of for one render.
    const data = await getMarketingKanbanData();
    return {
      statusColumns: data.statusColumns.map((c) => ({ id: c.id, statusKey: c.statusKey, label: c.label })),
      updates: data.updates.map((u) => ({
        updateId: u.updateId,
        assetId: u.assetId,
        sku: u.sku,
        itemName: u.itemName,
        campaign: u.campaign,
        platform: u.platform,
        postType: u.postType,
        postUrl: u.postUrl,
        creative: u.creative,
        caption: u.caption,
        marketingStatus: u.marketingStatus,
        postedAt: u.postedAt ? u.postedAt.toISOString() : null,
        highPerforming: u.highPerforming,
        notes: u.notes,
        nextAction: u.nextAction,
        createdAt: u.createdAt.toISOString(),
      })),
      unmarketedAssets: data.uploadedNotMarketedAssets.map((a) => ({
        id: a.id,
        sku: a.sku,
        itemName: a.itemName,
        category: a.category,
        currentStatus: a.currentStatus,
      })),
    };
  },
  ["marketing-view"],
  [CACHE_TAGS.marketing]
);

/** Loads the marketing board, falling back to an empty board when the query fails. The failure is not cached. */
export async function getMarketingViewSafe(): Promise<MarketingView> {
  try {
    return await getMarketingView();
  } catch (error) {
    console.error("Error loading marketing kanban data:", error);
    return EMPTY_MARKETING_VIEW;
  }
}

export interface CurationFieldView {
  fieldKey: string;
  displayName: string;
  fieldType: string;
  options: FieldOption[];
  appliesToCategories: string[] | null;
}

export const getCurationFieldsView = cachedView(
  async (): Promise<CurationFieldView[]> => {
    const fields = await getCurationFormFields();
    return fields.map((f) => ({
      fieldKey: f.fieldKey,
      displayName: f.displayName,
      fieldType: f.fieldType,
      options: normalizeFieldOptions(f.options),
      appliesToCategories: f.appliesToCategories,
    }));
  },
  ["curation-fields-view"],
  [CACHE_TAGS.curationFields]
);

export const getFormsView = cachedView(
  async (): Promise<FormSummary[]> => listForms(),
  ["forms-view"],
  [CACHE_TAGS.forms]
);
