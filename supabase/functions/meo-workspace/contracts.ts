import { z } from "zod";

export const workspaceRoles = ["owner", "admin", "editor", "analyst"] as const;
export type WorkspaceRole = (typeof workspaceRoles)[number];

export const workspaceResources = [
  "profile",
  "snapshots",
  "reviews",
  "review_templates",
  "media",
  "posts",
  "rank_observations",
  "insights",
  "aio_citations",
  "aio_observations",
  "jsonld",
  "organizations",
  "groups",
  "members",
  "change_requests",
  "audit",
] as const;
export type WorkspaceResource = (typeof workspaceResources)[number];
export const changeRequestResources = [
  "profile",
  "snapshots",
  "reviews",
  "review_templates",
  "media",
  "posts",
  "rank_observations",
  "insights",
  "aio_citations",
  "aio_observations",
  "jsonld",
  "groups",
] as const satisfies readonly WorkspaceResource[];

const boundedRecord = z.record(z.string().max(100), z.unknown());
const uuid = z.uuid();
const httpUrl = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "https:" || protocol === "http:";
}, "URL must use http or https");
const httpsUrl = z.url().refine(
  (value) => new URL(value).protocol === "https:",
  "URL must use https",
);
const nullableHttpUrl = httpUrl.nullable().optional();
const locale = z.string().trim().min(2).max(35).regex(
  /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/,
);
const timestamp = z.iso.datetime({ offset: true });
const date = z.iso.date();

export const emptyBodySchema = z.object({}).strict();
export const acceptInvitationSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();
export const mutationEnvelopeSchema = z.object({
  recordId: uuid.nullable().optional(),
  payload: boundedRecord.default({}),
}).strict();

export const profileSchema = z.object({
  businessName: z.string().trim().min(1).max(250),
  description: z.string().trim().max(750).nullable().optional(),
  primaryCategory: z.string().trim().min(1).max(250),
  additionalCategories: z.array(z.string().trim().min(1).max(250)).max(9)
    .default([]),
  phoneNumbers: z.object({
    primaryPhone: z.string().trim().max(50).nullable().optional(),
    additionalPhones: z.array(z.string().trim().min(1).max(50)).max(2).default(
      [],
    ),
  }).strict().optional(),
  websiteUri: nullableHttpUrl,
  businessHours: boundedRecord.optional(),
  specialHours: z.array(boundedRecord).max(366).optional(),
  moreHours: z.array(boundedRecord).max(20).optional(),
  address: boundedRecord.optional(),
  serviceArea: boundedRecord.optional(),
  attributes: boundedRecord.optional(),
  openingDate: date.nullable().optional(),
  labels: z.array(z.string().trim().min(1).max(255)).max(10).optional(),
  languageCode: locale.default("ja"),
}).strict();

export const reviewCreateSchema = z.object({
  provider: z.enum(["google_business", "manual", "csv"]),
  providerReviewId: z.string().trim().min(1).max(500).nullable().optional(),
  authorName: z.string().trim().max(250).nullable().optional(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(10_000).nullable().optional(),
  languageCode: locale.default("ja"),
  reviewedAt: timestamp,
  status: z.enum(["unread", "read", "needs_reply", "replied", "archived"])
    .default("unread"),
}).strict();

export const reviewPatchSchema = z.object({
  status: z.enum(["unread", "read", "needs_reply", "replied", "archived"])
    .optional(),
  languageCode: locale.optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  replyText: z.string().trim().max(4_096).nullable().optional(),
  replyLanguageCode: locale.nullable().optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  "at least one field is required",
);

const reviewTemplateFieldsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(4_096),
  languageCode: locale.default("ja"),
  minRating: z.number().int().min(1).max(5).nullable().optional(),
  maxRating: z.number().int().min(1).max(5).nullable().optional(),
}).strict();

export const reviewTemplateCreateSchema = reviewTemplateFieldsSchema.refine(
  (value) =>
    value.minRating == null || value.maxRating == null ||
    value.minRating <= value.maxRating,
  "rating range is invalid",
);

export const reviewTemplatePatchSchema = reviewTemplateFieldsSchema.partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "at least one field is required",
  );

export const mediaCreateSchema = z.object({
  kind: z.enum(["image", "video"]),
  source: z.enum([
    "upload",
    "instagram",
    "google_business",
    "external_url",
    "manual",
  ]),
  url: httpUrl,
  thumbnailUrl: nullableHttpUrl,
  altText: z.string().trim().max(500).nullable().optional(),
  width: z.number().int().positive().max(20_000).nullable().optional(),
  height: z.number().int().positive().max(20_000).nullable().optional(),
  mimeType: z.string().trim().min(3).max(100).nullable().optional(),
  byteSize: z.number().int().positive().max(104_857_600).nullable().optional(),
}).strict();

export const mediaPatchSchema = z.object({
  altText: z.string().trim().max(500).nullable().optional(),
  archived: z.boolean().optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  "at least one field is required",
);

const callToActionSchema = z.object({
  actionType: z.enum([
    "book",
    "order",
    "shop",
    "learn_more",
    "sign_up",
    "call",
  ]),
  url: httpsUrl.nullable().optional(),
}).strict();

const postFieldsSchema = z.object({
  topicType: z.enum(["update", "event", "offer"]),
  title: z.string().trim().max(58).nullable().optional(),
  summary: z.string().trim().min(1).max(1_500),
  languageCode: locale.default("ja"),
  callToAction: callToActionSchema.nullable().optional(),
  mediaAssetIds: z.array(uuid).max(10).default([]),
  event: boundedRecord.nullable().optional(),
  offer: boundedRecord.nullable().optional(),
  status: z.enum(["draft", "ready_for_manual_publish"]).default("draft"),
}).strict();

export const postCreateSchema = postFieldsSchema.superRefine(
  (value, context) => {
    if (value.topicType === "event" && !value.event) {
      context.addIssue({
        code: "custom",
        message: "event details are required",
        path: ["event"],
      });
    }
    if (value.topicType === "offer" && !value.offer) {
      context.addIssue({
        code: "custom",
        message: "offer details are required",
        path: ["offer"],
      });
    }
  },
);

export const postPatchSchema = postFieldsSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "at least one field is required",
);

export const publishConfirmationSchema = z.object({
  confirmedAt: timestamp,
  provider: z.enum(["google_business", "other"]),
  revision: z.number().int().min(1).max(10_000),
  revisionFingerprint: z.string().regex(/^[0-9a-f]{64}$/i).transform((value) =>
    value.toLowerCase()
  ),
  providerResourceName: z.string().trim().max(1_000).nullable().optional(),
  providerUrl: nullableHttpUrl,
  readback: boundedRecord.nullable().optional(),
  notes: z.string().trim().max(2_000).nullable().optional(),
}).strict();

export const rankObservationSchema = z.object({
  keyword: z.string().trim().min(1).max(200),
  rank: z.number().int().min(1).max(100).nullable(),
  matchedUrl: nullableHttpUrl,
  locationLabel: z.string().trim().min(1).max(250),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  observedAt: timestamp,
  source: z.enum(["manual", "csv", "owner_provider"]),
  targetPlaceId: z.string().trim().min(10).max(255).regex(/^[A-Za-z0-9_-]+$/),
  competitorPositions: z.array(boundedRecord).max(3).optional(),
  resultCount: z.number().int().min(0).max(100).nullable().optional(),
}).strict();

export const insightSchema = z.object({
  periodStart: date,
  periodEnd: date,
  metrics: z.record(
    z.string().trim().min(1).max(100),
    z.number().finite().min(0).max(1_000_000_000),
  ),
  source: z.enum(["manual", "csv", "google_business"]),
}).strict().refine(
  (value) => value.periodStart <= value.periodEnd,
  "period is invalid",
);

export const citationCreateSchema = z.object({
  directory: z.string().trim().min(1).max(120),
  sourceType: z.enum([
    "website",
    "directory",
    "social",
    "map",
    "assistant",
    "other",
  ]).default("directory"),
  listingUrl: httpsUrl.nullable().optional(),
  businessName: z.string().trim().max(250).nullable().optional(),
  address: z.string().trim().max(1_000).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  websiteUrl: httpsUrl.nullable().optional(),
  status: z.enum(["unknown", "consistent", "inconsistent", "missing"]),
  checkedAt: timestamp.nullable().optional(),
  notes: z.string().trim().max(2_000).nullable().optional(),
}).strict();

export const citationPatchSchema = citationCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "at least one field is required",
);

const aioObservationCreateFieldsSchema = z.object({
  prompt: z.string().trim().min(1).max(2_000),
  engine: z.enum(["chatgpt", "gemini", "perplexity", "copilot", "other"]),
  mentioned: z.boolean(),
  position: z.number().int().min(1).max(100).nullable().optional(),
  citedUrls: z.array(httpsUrl).max(50).default([]),
  observedAt: timestamp,
  notes: z.string().trim().max(4_000).nullable().optional(),
}).strict();

export const aioObservationCreateSchema = aioObservationCreateFieldsSchema;
export const aioObservationPatchSchema = aioObservationCreateFieldsSchema
  .omit({ citedUrls: true }).extend({
    citedUrls: z.array(httpsUrl).max(50).optional(),
  }).partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "at least one field is required",
  );

export const jsonLdSchema = z.object({
  type: z.enum([
    "LocalBusiness",
    "Restaurant",
    "Store",
    "ProfessionalService",
    "HealthAndBeautyBusiness",
  ]).default("LocalBusiness"),
  name: z.string().trim().min(1).max(250),
  url: nullableHttpUrl,
  image: nullableHttpUrl,
  telephone: z.string().trim().max(50).nullable().optional(),
  priceRange: z.string().trim().max(50).nullable().optional(),
  address: z.object({
    streetAddress: z.string().trim().max(500).nullable().optional(),
    addressLocality: z.string().trim().max(200).nullable().optional(),
    addressRegion: z.string().trim().max(200).nullable().optional(),
    postalCode: z.string().trim().max(30).nullable().optional(),
    addressCountry: z.string().trim().length(2).default("JP"),
  }).strict().optional(),
  geo: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }).strict().optional(),
  sameAs: z.array(httpUrl).max(50).optional(),
}).strict();

export const organizationCreateSchema = z.object({
  name: z.string().trim().min(1).max(250),
  slug: z.string().trim().min(2).max(63).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
  approvalPolicy: z.enum(["owner_direct", "two_person"]),
}).strict();
export const organizationPatchSchema = organizationCreateSchema.partial().omit({
  slug: true,
}).refine(
  (value) => Object.keys(value).length > 0,
  "at least one field is required",
);

export const groupCreateSchema = z.object({
  name: z.string().trim().min(1).max(250),
  description: z.string().trim().max(500).nullable().optional(),
  parentGroupId: uuid.nullable().optional(),
  storeIds: z.array(uuid).max(1_000).default([]),
}).strict();
export const groupPatchSchema = groupCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "at least one field is required",
);

export const memberCreateSchema = z.object({
  userId: uuid.nullable().optional(),
  email: z.email().max(320).nullable().optional(),
  role: z.enum(workspaceRoles),
  scope: z.enum(["organization", "store"]).default("organization"),
  groupIds: z.array(uuid).max(0, "group scopes are not supported").default([]),
}).strict().superRefine((value, context) => {
  if (!value.userId && !value.email) {
    context.addIssue({
      code: "custom",
      message: "userId or email is required",
      path: ["email"],
    });
  }
  if (!value.userId && value.role === "owner") {
    context.addIssue({
      code: "custom",
      message: "owner invitations are not allowed",
      path: ["role"],
    });
  }
});
export const memberPatchSchema = z.object({
  role: z.enum(workspaceRoles).optional(),
  scope: z.enum(["organization", "store"]).optional(),
  groupIds: z.array(uuid).max(0, "group scopes are not supported").optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  "at least one field is required",
);
export const memberDeleteSchema = z.object({
  scope: z.enum(["organization", "store"]).default("organization"),
}).strict();

export const changeRequestCreateSchema = z.object({
  resource: z.enum(changeRequestResources),
  action: z.enum([
    "save",
    "restore",
    "create",
    "update",
    "delete",
    "record_publish_confirmation",
  ]),
  recordId: uuid.nullable().optional(),
  payload: boundedRecord,
  reason: z.string().trim().max(2_000).nullable().optional(),
}).strict();
export const changeRequestDecisionSchema = z.object({
  comment: z.string().trim().max(2_000).nullable().optional(),
}).strict();

export function localBusinessJsonLd(
  input: z.infer<typeof jsonLdSchema>,
): Record<string, unknown> {
  const document: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": input.type,
    name: input.name,
  };
  if (input.url) document.url = input.url;
  if (input.image) document.image = input.image;
  if (input.telephone) document.telephone = input.telephone;
  if (input.priceRange) document.priceRange = input.priceRange;
  if (input.address) {
    document.address = { "@type": "PostalAddress", ...input.address };
  }
  if (input.geo) document.geo = { "@type": "GeoCoordinates", ...input.geo };
  if (input.sameAs?.length) document.sameAs = input.sameAs;
  return document;
}
