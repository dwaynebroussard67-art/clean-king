const ERROR_MESSAGES = Object.freeze({
  config: 'Assistant provider configuration is invalid.',
  auth: 'Assistant provider authentication failed.',
  rate_limit: 'Assistant provider rate limit reached.',
  timeout: 'Assistant provider request timed out.',
  upstream: 'Assistant provider is unavailable.',
  bad_response: 'Assistant provider returned an invalid response.',
  blocked_url: 'Assistant provider URL is not allowed.',
});

export class ProviderError extends Error {
  constructor(code) {
    const validCode = Object.hasOwn(ERROR_MESSAGES, code);
    super(validCode ? ERROR_MESSAGES[code] : ERROR_MESSAGES.upstream);
    this.name = 'ProviderError';
    this.code = validCode ? code : 'upstream';
  }
}
