export const QUICKPOS_EMAIL_COLORS = Object.freeze({
  ink: '#111827',
  primary: '#4f46e5',
  primarySoft: '#eef2ff',
  success: '#059669',
  canvas: '#f3f4f6',
  surface: '#ffffff',
  muted: '#64748b',
  line: '#e2e8f0',
});

export function escapeEmailHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function renderEmailDetails(details = []) {
  const rows = details.map(([label, value], index) => `
    <tr>
      <td style="padding:11px 14px;${index ? 'border-top:1px solid #e2e8f0;' : ''}color:#64748b;font-size:13px;line-height:1.45;vertical-align:top;">${escapeEmailHtml(label)}</td>
      <td align="right" style="padding:11px 14px;${index ? 'border-top:1px solid #e2e8f0;' : ''}color:#111827;font-size:14px;font-weight:700;line-height:1.45;vertical-align:top;">${escapeEmailHtml(value)}</td>
    </tr>`).join('');

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:22px 0;border:1px solid #e2e8f0;border-radius:12px;border-collapse:separate;overflow:hidden;background:#f8fafc;">${rows}</table>`;
}

export function renderQuickPosEmail({
  title,
  preheader,
  intro,
  badge = 'QuickPOS',
  contentHtml = '',
  cta,
  supportEmail = 'support@quickpos.com.ng',
  footerNote = 'This is a transactional message from QuickPOS.',
}) {
  const safeTitle = escapeEmailHtml(title);
  const safePreheader = escapeEmailHtml(preheader || intro || title);
  const safeIntro = escapeEmailHtml(intro || '');
  const safeBadge = escapeEmailHtml(badge);
  const safeSupport = escapeEmailHtml(supportEmail);
  const safeFooter = escapeEmailHtml(footerNote);
  const ctaHtml = cta?.url && cta?.label
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:26px 0 6px;"><tr><td bgcolor="#4f46e5" style="border-radius:10px;"><a href="${escapeEmailHtml(cta.url)}" style="display:inline-block;min-height:44px;line-height:44px;padding:0 22px;color:#ffffff;font-size:15px;font-weight:800;text-decoration:none;">${escapeEmailHtml(cta.label)}</a></td></tr></table>`
    : '';

  return `<!doctype html>
<html lang="en" dir="ltr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>${safeTitle}</title>
    <style>
      @media only screen and (max-width:620px) {
        .qp-shell { width:100% !important; }
        .qp-pad { padding-left:20px !important; padding-right:20px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#f3f4f6;color:#111827;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safePreheader}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f3f4f6;">
      <tr>
        <td align="center" style="padding:30px 12px;">
          <table class="qp-shell" role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;">
            <tr>
              <td class="qp-pad" style="padding:22px 28px;background:#111827;color:#ffffff;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td width="48" valign="middle"><div style="width:40px;height:40px;line-height:40px;text-align:center;border-radius:11px;background:#4f46e5;color:#ffffff;font-size:20px;font-weight:900;">Q</div></td>
                    <td valign="middle"><div style="font-size:20px;font-weight:850;letter-spacing:-0.5px;">QuickPOS</div><div style="margin-top:2px;color:#cbd5e1;font-size:12px;line-height:1.4;">Sales, stock, staff and reports</div></td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="qp-pad" style="padding:34px 28px 30px;">
                <span style="display:inline-block;margin:0 0 14px;padding:6px 10px;border-radius:999px;background:#eef2ff;color:#4338ca;font-size:12px;font-weight:800;line-height:1.2;">${safeBadge}</span>
                <h1 style="margin:0 0 14px;color:#111827;font-size:29px;line-height:1.2;letter-spacing:-0.7px;">${safeTitle}</h1>
                ${safeIntro ? `<p style="margin:0;color:#475569;font-size:16px;line-height:1.65;">${safeIntro}</p>` : ''}
                ${contentHtml}
                ${ctaHtml}
                <p style="margin:24px 0 0;color:#64748b;font-size:14px;line-height:1.65;">Need help? Contact <a href="mailto:${safeSupport}" style="color:#4f46e5;font-weight:700;text-decoration:none;">${safeSupport}</a>.</p>
              </td>
            </tr>
            <tr>
              <td class="qp-pad" style="padding:18px 28px;border-top:1px solid #e2e8f0;background:#f8fafc;color:#64748b;font-size:12px;line-height:1.6;">${safeFooter}<br>QuickPOS is operated by SIRDAVID MULTI-TRADE LTD.</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
