import JSZip from 'jszip';
import PDFDocument from 'pdfkit';
import { Resend } from 'resend';

import config from '../../config/index.js';
import { query } from '../../config/database.js';

const PDF_MIME = 'application/pdf';
const EXCEL_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function parseOptionalDate(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw httpError(400, `${fieldName} must use YYYY-MM-DD format`);
  }

  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw httpError(400, `${fieldName} is not a valid date`);
  }

  return value;
}

export function normalizeStatementFilters(filters = {}) {
  const startDate = parseOptionalDate(filters.start_date, 'start_date');
  const endDate = parseOptionalDate(filters.end_date, 'end_date');

  if (startDate && endDate && startDate > endDate) {
    throw httpError(400, 'start_date cannot be after end_date');
  }

  return { startDate, endDate };
}

function toAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function formatDate(value) {
  return new Date(value).toLocaleDateString('en-NG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatPeriodDate(value) {
  if (!value) return null;
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-NG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function formatMoney(value, currency = 'NGN') {
  return `${currency} ${toAmount(value).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function safeFilePart(value) {
  return String(value || 'store')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'store';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function getStoreStatement(storeId, filters = {}, queryFn = query) {
  const { startDate, endDate } = normalizeStatementFilters(filters);

  const storeResult = await queryFn(
    `SELECT id, name, address, phone, email, currency, logo_url
     FROM stores
     WHERE id = $1`,
    [storeId]
  );

  const params = [storeId];
  let ordersSql = `
    SELECT
      o.id,
      o.order_number,
      o.created_at,
      o.subtotal,
      o.tax_amount,
      o.discount_amount,
      o.total,
      o.payment_method,
      o.status,
      u.name AS cashier_name,
      COALESCE(SUM(oi.quantity), 0)::int AS item_count
    FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE o.store_id = $1
  `;

  if (startDate) {
    params.push(startDate);
    ordersSql += ` AND o.created_at >= $${params.length}::date`;
  }

  if (endDate) {
    params.push(endDate);
    ordersSql += ` AND o.created_at < ($${params.length}::date + INTERVAL '1 day')`;
  }

  ordersSql += `
    GROUP BY o.id, u.name
    ORDER BY o.created_at ASC, o.id ASC
  `;

  const ordersResult = await queryFn(ordersSql, params);
  let cumulativeTotal = 0;

  const transactions = ordersResult.rows.map((order) => {
    const amount = toAmount(order.total);
    if (order.status === 'completed') cumulativeTotal += amount;

    return {
      id: order.id,
      order_number: order.order_number,
      created_at: order.created_at,
      payment_method: order.payment_method || 'cash',
      status: order.status,
      cashier_name: order.cashier_name || 'System',
      item_count: Number(order.item_count) || 0,
      subtotal: toAmount(order.subtotal),
      tax_amount: toAmount(order.tax_amount),
      discount_amount: toAmount(order.discount_amount),
      total: amount,
      cumulative_total: cumulativeTotal,
    };
  });

  const completed = transactions.filter((transaction) => transaction.status === 'completed');
  const totalSpent = completed.reduce((sum, transaction) => sum + transaction.total, 0);
  const totalTax = completed.reduce((sum, transaction) => sum + transaction.tax_amount, 0);
  const totalDiscount = completed.reduce((sum, transaction) => sum + transaction.discount_amount, 0);
  const totalItems = completed.reduce((sum, transaction) => sum + transaction.item_count, 0);

  return {
    store: storeResult.rows[0] || { id: storeId, name: 'QuickPOS Store', currency: 'NGN' },
    period: {
      start_date: startDate,
      end_date: endDate,
      label: startDate || endDate
        ? `${formatPeriodDate(startDate) || 'Beginning'} to ${formatPeriodDate(endDate) || 'Present'}`
        : 'All transactions',
    },
    summary: {
      total_orders: transactions.length,
      completed_orders: completed.length,
      total_sales: totalSpent,
      total_tax: totalTax,
      total_discount: totalDiscount,
      total_items: totalItems,
      average_sale: completed.length ? totalSpent / completed.length : 0,
    },
    transactions,
    generated_at: new Date().toISOString(),
  };
}

function drawPdfTableHeader(doc, y) {
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor('#374151')
    .text('Date', 40, y, { width: 60 })
    .text('Order', 100, y, { width: 90 })
    .text('Cashier', 190, y, { width: 90 })
    .text('Payment', 280, y, { width: 55 })
    .text('Status', 335, y, { width: 55 })
    .text('Amount', 390, y, { width: 75, align: 'right' })
    .text('Cumulative', 465, y, { width: 90, align: 'right' });

  doc.moveTo(40, y + 14).lineTo(555, y + 14).strokeColor('#d1d5db').stroke();
  return y + 20;
}

export async function createStatementPdf(statement) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));

  const completed = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const currency = statement.store.currency || 'NGN';
  const storeContact = [statement.store.address, statement.store.phone, statement.store.email]
    .filter(Boolean)
    .join(' | ');

  doc.font('Helvetica-Bold').fontSize(20).fillColor('#111827').text(statement.store.name || 'QuickPOS Store');
  if (storeContact) {
    doc.font('Helvetica').fontSize(8).fillColor('#6b7280').text(storeContact, { width: 515 });
  }

  doc.moveDown(1);
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#111827').text('Store Sales Statement');
  doc.font('Helvetica').fontSize(9).fillColor('#4b5563').text(`Period: ${statement.period.label}`);
  doc.text(`Generated: ${new Date(statement.generated_at).toLocaleString('en-NG')}`);

  doc.moveDown(1);
  const summaryY = doc.y;
  const summaries = [
    ['Orders', statement.summary.total_orders],
    ['Items sold', statement.summary.total_items],
    ['Total sales', formatMoney(statement.summary.total_sales, currency)],
    ['Average sale', formatMoney(statement.summary.average_sale, currency)],
  ];

  summaries.forEach(([label, value], index) => {
    const x = 40 + (index * 129);
    doc.roundedRect(x, summaryY, 119, 46, 4).fillAndStroke('#f3f4f6', '#e5e7eb');
    doc.font('Helvetica').fontSize(7).fillColor('#6b7280').text(label, x + 8, summaryY + 8, { width: 103 });
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(String(value), x + 8, summaryY + 23, {
      width: 103,
      ellipsis: true,
    });
  });

  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor('#4b5563')
    .text(
      `Completed orders: ${statement.summary.completed_orders} | Tax: ${formatMoney(statement.summary.total_tax, currency)} | Discounts: ${formatMoney(statement.summary.total_discount, currency)}`,
      40,
      summaryY + 53,
      { width: 515 }
    );

  let y = drawPdfTableHeader(doc, summaryY + 76);

  if (statement.transactions.length === 0) {
    doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text('No transactions found for this period.', 40, y + 8);
  } else {
    statement.transactions.forEach((transaction) => {
      if (y > 748) {
        doc.addPage();
        y = drawPdfTableHeader(doc, 45);
      }

      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor('#111827')
        .text(formatDate(transaction.created_at), 40, y, { width: 60 })
        .text(transaction.order_number, 100, y, { width: 90, ellipsis: true })
        .text(transaction.cashier_name, 190, y, { width: 90, ellipsis: true })
        .text(transaction.payment_method.toUpperCase(), 280, y, { width: 55 })
        .text(transaction.status.toUpperCase(), 335, y, { width: 55 })
        .text(formatMoney(transaction.total, currency), 390, y, { width: 75, align: 'right' })
        .text(formatMoney(transaction.cumulative_total, currency), 465, y, { width: 90, align: 'right' });

      doc.moveTo(40, y + 18).lineTo(555, y + 18).strokeColor('#eeeeee').stroke();
      y += 25;
    });
  }

  const pageRange = doc.bufferedPageRange();
  for (let index = 0; index < pageRange.count; index += 1) {
    doc.switchToPage(pageRange.start + index);
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#9ca3af')
      .text(
        `Page ${index + 1} of ${pageRange.count} | Cumulative revenue includes completed sales only.`,
        40,
        785,
        { width: 515, align: 'center' }
      );
  }

  doc.end();
  return completed;
}

export async function createStatementExcel(statement) {
  const currency = statement.store.currency || 'NGN';
  const stringCell = (reference, value, style = 0) => (
    `<c r="${reference}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
  );
  const numberCell = (reference, value, style = 0) => (
    `<c r="${reference}" s="${style}"><v>${toAmount(value)}</v></c>`
  );
  const row = (number, cells, height) => (
    `<row r="${number}"${height ? ` ht="${height}" customHeight="1"` : ''}>${cells.join('')}</row>`
  );

  const rows = [
    row(1, [stringCell('A1', statement.store.name || 'QuickPOS Store', 1)], 26),
    row(2, [stringCell('A2', 'Store Sales Statement', 2)], 22),
    row(4, [
      stringCell('A4', 'Store', 3),
      stringCell('B4', statement.store.name || 'QuickPOS Store'),
      stringCell('D4', 'Period', 3),
      stringCell('E4', statement.period.label),
    ]),
    row(5, [
      stringCell('A5', 'Store Email', 3),
      stringCell('B5', statement.store.email || '-'),
      stringCell('D5', 'Generated', 3),
      stringCell('E5', new Date(statement.generated_at).toLocaleString('en-NG')),
    ]),
    row(7, [
      stringCell('A7', 'Total orders', 3),
      numberCell('B7', statement.summary.total_orders),
      stringCell('C7', 'Completed orders', 3),
      numberCell('D7', statement.summary.completed_orders),
      stringCell('E7', 'Total sales', 3),
      numberCell('F7', statement.summary.total_sales, 5),
    ]),
    row(8, [
      stringCell('A8', 'Items sold', 3),
      numberCell('B8', statement.summary.total_items),
      stringCell('C8', 'Total tax', 3),
      numberCell('D8', statement.summary.total_tax, 5),
      stringCell('E8', 'Total discount', 3),
      numberCell('F8', statement.summary.total_discount, 5),
    ]),
    row(9, [
      stringCell('A9', 'Average sale', 3),
      numberCell('B9', statement.summary.average_sale, 5),
    ]),
    row(11, [
      stringCell('A11', 'Date', 4),
      stringCell('B11', 'Order Number', 4),
      stringCell('C11', 'Cashier', 4),
      stringCell('D11', 'Items', 4),
      stringCell('E11', 'Payment Method', 4),
      stringCell('F11', 'Status', 4),
      stringCell('G11', 'Amount', 4),
      stringCell('H11', 'Cumulative Revenue', 4),
    ], 22),
  ];

  statement.transactions.forEach((transaction, index) => {
    const rowNumber = 12 + index;
    rows.push(row(rowNumber, [
      stringCell(`A${rowNumber}`, formatDate(transaction.created_at)),
      stringCell(`B${rowNumber}`, transaction.order_number),
      stringCell(`C${rowNumber}`, transaction.cashier_name),
      numberCell(`D${rowNumber}`, transaction.item_count),
      stringCell(`E${rowNumber}`, transaction.payment_method.toUpperCase()),
      stringCell(`F${rowNumber}`, transaction.status.toUpperCase()),
      numberCell(`G${rowNumber}`, transaction.total, 5),
      numberCell(`H${rowNumber}`, transaction.cumulative_total, 5),
    ]));
  });

  const lastRow = Math.max(11, 11 + statement.transactions.length);
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetViews>
        <sheetView workbookViewId="0">
          <pane ySplit="11" topLeftCell="A12" activePane="bottomLeft" state="frozen"/>
        </sheetView>
      </sheetViews>
      <cols>
        <col min="1" max="1" width="15" customWidth="1"/>
        <col min="2" max="2" width="24" customWidth="1"/>
        <col min="3" max="3" width="20" customWidth="1"/>
        <col min="4" max="4" width="10" customWidth="1"/>
        <col min="5" max="6" width="16" customWidth="1"/>
        <col min="7" max="8" width="20" customWidth="1"/>
      </cols>
      <sheetData>${rows.join('')}</sheetData>
      <autoFilter ref="A11:H${lastRow}"/>
      <mergeCells count="2"><mergeCell ref="A1:H1"/><mergeCell ref="A2:H2"/></mergeCells>
    </worksheet>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;${escapeXml(currency)}&quot; #,##0.00"/></numFmts>
      <fonts count="4">
        <font><sz val="11"/><name val="Calibri"/></font>
        <font><b/><sz val="18"/><color rgb="FF111827"/><name val="Calibri"/></font>
        <font><b/><sz val="14"/><name val="Calibri"/></font>
        <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
      </fonts>
      <fills count="3">
        <fill><patternFill patternType="none"/></fill>
        <fill><patternFill patternType="gray125"/></fill>
        <fill><patternFill patternType="solid"><fgColor rgb="FF4F46E5"/><bgColor indexed="64"/></patternFill></fill>
      </fills>
      <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
      <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
      <cellXfs count="6">
        <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
        <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
        <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
        <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
        <xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
        <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
      </cellXfs>
      <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
    </styleSheet>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
      <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
    </Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
    </Relationships>`);
  zip.folder('xl').file('workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sheets><sheet name="Sales Statement" sheetId="1" r:id="rId1"/></sheets>
    </workbook>`);
  zip.folder('xl').folder('_rels').file('workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
    </Relationships>`);
  zip.folder('xl').folder('worksheets').file('sheet1.xml', worksheet);
  zip.folder('xl').file('styles.xml', styles);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export async function createStatementFile(statement, format) {
  if (format === 'pdf') {
    return {
      buffer: await createStatementPdf(statement),
      mimeType: PDF_MIME,
      extension: 'pdf',
    };
  }

  if (format === 'xlsx') {
    return {
      buffer: await createStatementExcel(statement),
      mimeType: EXCEL_MIME,
      extension: 'xlsx',
    };
  }

  throw httpError(400, 'format must be pdf or xlsx');
}

export function createStatementFilename(statement, extension) {
  const period = statement.period.end_date || new Date(statement.generated_at).toISOString().slice(0, 10);
  return `sales-statement-${safeFilePart(statement.store.name)}-${period}.${extension}`;
}

export async function sendStatementEmail({ statement, recipient, format }) {
  if (!config.email.resendApiKey || !config.email.from) {
    throw httpError(503, 'Email delivery is not configured. Set RESEND_API_KEY and EMAIL_FROM.');
  }

  const file = await createStatementFile(statement, format);
  const filename = createStatementFilename(statement, file.extension);
  const resend = new Resend(config.email.resendApiKey);
  const currency = statement.store.currency || 'NGN';

  const { data, error } = await resend.emails.send({
    from: config.email.from,
    to: recipient,
    replyTo: config.email.replyTo || undefined,
    subject: `${statement.store.name || 'QuickPOS'} sales statement`,
    html: `
      <div style="font-family:Arial,sans-serif;color:#111827;line-height:1.5;">
        <h2 style="margin-bottom:8px;">Store Sales Statement</h2>
        <p>Your store sales statement for <strong>${escapeHtml(statement.period.label)}</strong> is attached.</p>
        <table style="border-collapse:collapse;margin:20px 0;">
          <tr><td style="padding:6px 18px 6px 0;color:#6b7280;">Completed orders</td><td style="padding:6px 0;font-weight:700;">${statement.summary.completed_orders}</td></tr>
          <tr><td style="padding:6px 18px 6px 0;color:#6b7280;">Total sales</td><td style="padding:6px 0;font-weight:700;">${escapeHtml(formatMoney(statement.summary.total_sales, currency))}</td></tr>
        </table>
        <p>Regards,<br>${escapeHtml(statement.store.name || 'QuickPOS Store')}</p>
      </div>
    `,
    attachments: [{
      filename,
      content: file.buffer,
      contentType: file.mimeType,
    }],
  });

  if (error) {
    throw httpError(error.statusCode || 502, error.message || 'Email delivery failed');
  }

  return { id: data?.id, filename };
}
