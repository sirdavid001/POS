export const LEGAL_DOCUMENT_VERSIONS = Object.freeze({
  terms: '2026-06-11',
  privacy: '2026-06-11',
  refund: '2026-06-11',
});

export async function recordLegalAcceptances(
  executor,
  {
    userId,
    storeId,
    documents,
    context,
    ipAddress = null,
    userAgent = null,
  }
) {
  const values = documents.map((documentType) => [
    userId,
    storeId,
    documentType,
    LEGAL_DOCUMENT_VERSIONS[documentType],
    context,
    ipAddress,
    userAgent,
  ]);

  for (const value of values) {
    await executor.query(
      `INSERT INTO legal_acceptances
       (user_id, store_id, document_type, document_version, context, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, document_type, document_version, context) DO NOTHING`,
      value
    );
  }
}
