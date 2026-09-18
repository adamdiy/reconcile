import { z } from 'zod';

export const IsoInstant = z.string().datetime({ offset: true });

export const UnknownReasonSchema = z.enum([
  'unmapped_identity',
  'ambiguous_identity',
  'unsupported_policy',
  'unsupported_billing_model',
  'stale_evidence',
  'incomplete_inventory',
  'connector_unavailable',
  'conflicting_rules',
  'conflicting_exceptions',
  'missing_permission',
  'unobserved_feature',
  'not_observed',
]);
export type UnknownReason = z.infer<typeof UnknownReasonSchema>;

export const FeatureEvaluationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('match'),
    ruleId: z.string(),
    feature: z.string(),
    expected: z.boolean(),
    evidenceIds: z.array(z.string()),
  }),
  z.object({
    kind: z.literal('mismatch'),
    ruleId: z.string(),
    feature: z.string(),
    expected: z.boolean(),
    observed: z.boolean(),
    evidenceIds: z.array(z.string()),
  }),
  z.object({
    kind: z.literal('unknown'),
    ruleId: z.string().optional(),
    feature: z.string(),
    reasons: z.array(UnknownReasonSchema),
    evidenceIds: z.array(z.string()),
  }),
]);
export type FeatureEvaluation = z.infer<typeof FeatureEvaluationSchema>;

export const IntegrityFindingSchema = z.object({
  kind: z.literal('duplicate_local_identity'),
  localRecordIds: z.array(z.string()),
  stripeSubscriptionId: z.string().optional(),
  evidenceIds: z.array(z.string()),
});
export type IntegrityFinding = z.infer<typeof IntegrityFindingSchema>;

export const QuantityEvaluationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('match'),
    check: z.enum(['seats', 'usage']),
    metric: z.string().optional(),
    expected: z.number(),
    observed: z.number(),
    evidenceIds: z.array(z.string()),
  }),
  z.object({
    kind: z.literal('mismatch'),
    check: z.enum(['seats', 'usage']),
    metric: z.string().optional(),
    expected: z.number(),
    observed: z.number(),
    evidenceIds: z.array(z.string()),
  }),
  z.object({
    kind: z.literal('unknown'),
    check: z.enum(['seats', 'usage']),
    metric: z.string().optional(),
    expected: z.number(),
    observed: z.number().optional(),
    reasons: z.array(UnknownReasonSchema),
    evidenceIds: z.array(z.string()),
  }),
]);
export type QuantityEvaluation = z.infer<typeof QuantityEvaluationSchema>;

export const AccountAssessmentSchema = z.object({
  quantityChecks: z.array(QuantityEvaluationSchema).default([]),
  accountId: z.string(),
  policyVersion: z.string(),
  engineVersion: z.string(),
  evaluatedAt: IsoInstant,
  accountReasons: z.array(UnknownReasonSchema),
  features: z.array(FeatureEvaluationSchema),
  integrity: z.array(IntegrityFindingSchema),
  nextTransitionAt: IsoInstant.optional(),
});
export type AccountAssessment = z.infer<typeof AccountAssessmentSchema>;

export const SubscriptionStatusSchema = z.enum([
  'trialing',
  'active',
  'past_due',
  'unpaid',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'paused',
]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;

export const StripeSubscriptionFactSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  status: SubscriptionStatusSchema,
  items: z.array(
    z.object({
      priceId: z.string(),
      quantity: z.number(),
      usageType: z.enum(['licensed', 'metered']).optional(),
    }),
  ),
  usageRecords: z
    .array(
      z.object({
        priceId: z.string(),
        quantity: z.number(),
        periodStart: IsoInstant,
        periodEnd: IsoInstant,
      }),
    )
    .optional(),
  scheduleId: z.string().optional(),
  pauseCollection: z.boolean().optional(),
  trialEnd: IsoInstant.optional(),
  currentPeriodEnd: IsoInstant.optional(),
  cancelAtPeriodEnd: z.boolean(),
  cancelAt: IsoInstant.optional(),
  canceledAt: IsoInstant.optional(),
  firstFailedInvoiceDueAt: IsoInstant.optional(),
  zeroValue: z.boolean().optional(),
  observedAt: IsoInstant,
  sourceRevision: z.string().optional(),
});
export type StripeSubscriptionFact = z.infer<typeof StripeSubscriptionFactSchema>;

export const StripeCustomerFactSchema = z.object({
  id: z.string(),
  deleted: z.boolean(),
  observedAt: IsoInstant,
});
export type StripeCustomerFact = z.infer<typeof StripeCustomerFactSchema>;

export const StripeInventorySchema = z.object({
  runId: z.string(),
  complete: z.boolean(),
  observedAt: IsoInstant,
  permissionsMissing: z.array(z.string()),
  customers: z.array(StripeCustomerFactSchema),
  subscriptions: z.array(StripeSubscriptionFactSchema),
});
export type StripeInventory = z.infer<typeof StripeInventorySchema>;

export const LocalBillingRecordSchema = z.object({
  localId: z.string(),
  stripeSubscriptionId: z.string().optional(),
  stripeCustomerId: z.string().optional(),
  status: z.string().optional(),
});
export type LocalBillingRecord = z.infer<typeof LocalBillingRecordSchema>;

export const AccountObservationSchema = z.object({
  accountId: z.string(),
  stripeCustomerIds: z.array(z.string()),
  localBillingRecords: z.array(LocalBillingRecordSchema),
  observedAt: IsoInstant,
  sourceRevision: z.string().optional(),
  method: z.enum(['database_view', 'authorization_adapter']),
  access: z.record(z.boolean()),
  seatsUsed: z.number().optional(),
  usage: z.record(z.number()).optional(),
  contextsChecked: z
    .array(z.object({ subject: z.string(), resource: z.string(), action: z.string() }))
    .optional(),
});
export type AccountObservation = z.infer<typeof AccountObservationSchema>;

export const AppInventorySchema = z.object({
  runId: z.string(),
  complete: z.boolean(),
  observedAt: IsoInstant,
  accounts: z.array(AccountObservationSchema),
});
export type AppInventory = z.infer<typeof AppInventorySchema>;

export const IdentityLinkSchema = z.object({
  accountId: z.string(),
  stripeCustomerId: z.string(),
  reviewed: z.literal(true),
});
export type IdentityLink = z.infer<typeof IdentityLinkSchema>;

export const PolicySchema = z.object({
  version: z.string(),
  ruleIdPrefix: z.string().optional(),
  capabilities: z.array(z.string()),
  priceMappings: z.array(
    z.object({
      ruleId: z.string(),
      priceId: z.string(),
      capabilities: z.array(z.string()),
    }),
  ),
  lifecycle: z.object({
    pastDueGraceHours: z.number(),
    trialGrantsAccess: z.boolean(),
  }),
  freshness: z.object({
    maxEvidenceAgeMinutes: z.number(),
  }),
  seats: z.object({ priceIds: z.array(z.string()) }).optional(),
  usage: z
    .array(z.object({ metric: z.string(), priceId: z.string(), tolerancePct: z.number() }))
    .optional(),
});
export type Policy = z.infer<typeof PolicySchema>;

export const PolicyExceptionSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  capability: z.string(),
  expected: z.boolean(),
  reason: z.string(),
  owner: z.string(),
  expiresAt: IsoInstant,
});
export type PolicyException = z.infer<typeof PolicyExceptionSchema>;

export const EvaluationInputSchema = z.object({
  stripe: StripeInventorySchema,
  app: AppInventorySchema,
  links: z.array(IdentityLinkSchema),
  policy: PolicySchema,
  exceptions: z.array(PolicyExceptionSchema),
  evaluatedAt: IsoInstant,
  engineVersion: z.string().optional(),
});
export type EvaluationInput = z.infer<typeof EvaluationInputSchema>;

export const SeveritySchema = z.enum(['low', 'medium', 'high']);
export type Severity = z.infer<typeof SeveritySchema>;

export const CheckKindSchema = z.enum([
  'unexpected_feature_enabled',
  'expected_feature_missing',
  'wrong_feature_set',
  'duplicate_local_identity',
  'coverage_gap',
  'monitoring_health',
  'seats_over_cap',
  'usage_not_billed',
]);
export type CheckKind = z.infer<typeof CheckKindSchema>;

export const IncidentKindSchema = z.enum(['mismatch', 'integrity', 'coverage', 'health']);
export type IncidentKind = z.infer<typeof IncidentKindSchema>;

export const IncidentStateSchema = z.enum(['candidate', 'confirmed', 'resolved']);
export type IncidentState = z.infer<typeof IncidentStateSchema>;

export const IncidentSnapshotSchema = z.object({
  accountId: z.string(),
  ruleId: z.string(),
  feature: z.string(),
  check: CheckKindSchema,
  kind: IncidentKindSchema,
  severity: SeveritySchema,
  expected: z.boolean().optional(),
  observed: z.boolean().optional(),
  expectedQuantity: z.number().optional(),
  observedQuantity: z.number().optional(),
  reasons: z.array(z.string()).optional(),
  evidenceIds: z.array(z.string()),
});
export type IncidentSnapshot = z.infer<typeof IncidentSnapshotSchema>;

export const IncidentWorkflowSchema = z.object({
  assignee: z.string().optional(),
  snoozedUntil: IsoInstant.optional(),
  acceptedRisk: z
    .object({ reason: z.string(), by: z.string(), at: IsoInstant })
    .optional(),
  comments: z.array(z.object({ by: z.string(), at: IsoInstant, text: z.string() })),
});
export type IncidentWorkflow = z.infer<typeof IncidentWorkflowSchema>;

export const StoredIncidentSchema = z.object({
  firstSeenAt: IsoInstant,
  lastConfirmedAt: IsoInstant,
  occurrences: z.number(),
  state: IncidentStateSchema,
  resolutionReason: z.string().optional(),
  evidenceStale: z.boolean().optional(),
  workflow: IncidentWorkflowSchema.optional(),
  snapshot: IncidentSnapshotSchema,
});
export type StoredIncident = z.infer<typeof StoredIncidentSchema>;

export const UserRoleSchema = z.enum(['viewer', 'reviewer', 'admin']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const UserSchema = z.object({
  id: z.string(),
  email: z.string().min(1),
  passwordHash: z.string(),
  role: UserRoleSchema,
  projectIds: z.array(z.string()),
});
export type User = z.infer<typeof UserSchema>;

export const IncidentSchema = IncidentSnapshotSchema.extend({
  id: z.string(),
  state: IncidentStateSchema,
  firstSeenAt: IsoInstant,
  lastConfirmedAt: IsoInstant,
  occurrences: z.number(),
  resolutionReason: z.string().optional(),
  evidenceStale: z.boolean().optional(),
  workflow: IncidentWorkflowSchema.optional(),
});
export type Incident = z.infer<typeof IncidentSchema>;

export const JobKindSchema = z.enum(['assess', 'stripe_sync', 'notify', 'digest']);
export type JobKind = z.infer<typeof JobKindSchema>;

export const JobStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'dead']);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  kind: JobKindSchema,
  payload: z.record(z.unknown()),
  idempotencyKey: z.string(),
  status: JobStatusSchema,
  attempts: z.number().int(),
  maxAttempts: z.number().int(),
  runAfter: IsoInstant,
  leaseUntil: IsoInstant.optional(),
  lastError: z.string().optional(),
  createdAt: IsoInstant,
  updatedAt: IsoInstant,
});
export type Job = z.infer<typeof JobSchema>;

export const ScheduleSchema = z.object({
  projectId: z.string(),
  scanIntervalMinutes: z.number().int().min(1).default(1440),
  digestHour: z.number().int().min(0).max(23).default(9),
  enabled: z.boolean(),
});
export type Schedule = z.infer<typeof ScheduleSchema>;

export const NotificationRuleSchema = z.object({
  id: z.string(),
  channel: z.enum(['slack', 'email', 'outbox']),
  target: z.string().default(''),
  checkKinds: z.union([z.array(CheckKindSchema), z.literal('all')]).default('all'),
  minSeverity: SeveritySchema.default('low'),
  // Matched against incident.state, or resolutionReason for resolved incidents
  // (e.g. 'verified_remediated').
  states: z.array(z.string()).default(['confirmed', 'verified_remediated']),
  enabled: z.boolean(),
});
export type NotificationRule = z.infer<typeof NotificationRuleSchema>;

export const EvidenceSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  observedAt: IsoInstant.optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const IncidentExplanationSchema = z.object({
  summary: z.string(),
  hypotheses: z.array(
    z.object({
      text: z.string(),
      evidenceIds: z.array(z.string()),
      confidence: z.enum(['low', 'medium', 'high']),
    }),
  ),
  suggestedNextStep: z.string(),
  provider: z.string(),
  model: z.string(),
  generatedAt: IsoInstant,
});
export type IncidentExplanation = z.infer<typeof IncidentExplanationSchema>;

export const ExceptionDraftSchema = z.object({
  exception: PolicyExceptionSchema,
  rationale: z.string(),
  quotedSource: z.array(z.string()),
  provider: z.string(),
  model: z.string(),
  generatedAt: IsoInstant,
});
export type ExceptionDraft = z.infer<typeof ExceptionDraftSchema>;

export const AuditBaselineSchema = z.object({
  id: z.string(),
  name: z.string(),
  note: z.string().optional(),
  createdAt: IsoInstant,
  createdBy: z.string(),
  policyVersion: z.string(),
  engineVersion: z.string(),
  sourceObservedAt: z.object({ stripe: IsoInstant, app: IsoInstant }),
  assessments: z.array(AccountAssessmentSchema),
  counts: z.object({
    population: z.number(),
    buckets: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    coveredPairs: z.number(),
    totalPairs: z.number(),
    incidentsOpen: z.number(),
    unknownReasons: z.record(z.number()).optional(),
  }),
});
export type AuditBaseline = z.infer<typeof AuditBaselineSchema>;
