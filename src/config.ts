/**
 * Reads all external service configuration from environment variables.
 * In production, inject via a .env file or system environment variables.
 * Never hard-code any API keys here.
 */
export const config = {
  perplexity: {
    apiKey: process.env.PERPLEXITY_API_KEY ?? "",
    baseUrl: process.env.PERPLEXITY_BASE_URL ?? "https://api.perplexity.ai",
    model: process.env.PERPLEXITY_MODEL ?? "sonar",
  },
  firecrawl: {
    apiKey: process.env.FIRECRAWL_API_KEY ?? "",
    baseUrl: process.env.FIRECRAWL_BASE_URL ?? "https://api.firecrawl.dev/v1",
  },
};
