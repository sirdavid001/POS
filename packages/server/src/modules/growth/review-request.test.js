import { describe, expect, test } from 'vitest';
import { buildReviewRequest, reviewRequestEnabled } from './review-request.js';

describe('review request email', () => {
  const message = buildReviewRequest({
    name: 'Ada',
    storeName: 'Ada <Mart>',
    reviewUrl: 'https://www.trustpilot.com/evaluate/quickpos.com.ng',
    supportEmail: 'support@quickpos.com.ng',
  });

  test('asks every customer for an honest review without rewards', () => {
    expect(message.subject).toBe('How is QuickPOS working for Ada <Mart>?');
    expect(message.text).toContain('good or bad');
    expect(message.text).toContain('never offer discounts or rewards');
    expect(message.text).toContain('https://www.trustpilot.com/evaluate/quickpos.com.ng');
    expect(message.html).toContain('Write a review');
    expect(message.html).toContain('href="https://www.trustpilot.com/evaluate/quickpos.com.ng"');
  });

  test('escapes store names in the HTML body', () => {
    expect(message.html).toContain('Ada &lt;Mart&gt;');
    expect(message.html).not.toContain('Ada <Mart>');
  });

  test('stays off until an https review URL is configured', () => {
    expect(reviewRequestEnabled({ reviewRequestUrl: '' })).toBe(false);
    expect(reviewRequestEnabled({ reviewRequestUrl: 'not a url' })).toBe(false);
    expect(reviewRequestEnabled({ reviewRequestUrl: 'http://example.com/review' })).toBe(false);
    expect(reviewRequestEnabled({ reviewRequestUrl: 'https://example.com/review' })).toBe(true);
  });
});
