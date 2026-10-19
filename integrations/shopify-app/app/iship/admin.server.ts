/** The part of Shopify's admin API client this app uses. */
export interface AdminGraphql {
  graphql(query: string, options?: { variables?: Record<string, unknown> }): Promise<Response>;
}

export class ShopifyError extends Error {}

/**
 * Runs a GraphQL document and returns its `data`, throwing on top-level errors
 * and on `userErrors` in the first mutation payload.
 */
export async function gql<T>(admin: AdminGraphql, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const response = await admin.graphql(query, { variables });
  const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new ShopifyError(body.errors.map((e) => e.message).join("; "));
  if (!body.data) throw new ShopifyError("Shopify returned no data");

  for (const payload of Object.values(body.data as Record<string, unknown>)) {
    const userErrors = (payload as { userErrors?: { message: string }[] } | null)?.userErrors;
    if (userErrors?.length) throw new ShopifyError(userErrors.map((e) => e.message).join("; "));
  }
  return body.data;
}
