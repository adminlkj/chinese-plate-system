/**
 * ZATCA e-invoice QR code TLV (Tag-Length-Value) encoder
 * Per ZATCA specification for Simplified Tax Invoices
 */

function encodeTLV(tag: number, value: string): Buffer {
  const valueBytes = Buffer.from(value, 'utf-8');
  const buf = Buffer.alloc(2 + valueBytes.length);
  buf.writeUInt8(tag, 0);
  buf.writeUInt8(valueBytes.length, 1);
  valueBytes.copy(buf, 2);
  return buf;
}

export function generateZatcaQR(params: {
  sellerName: string;
  vatNumber: string;
  timestamp: string;
  totalAmount: string;
  vatAmount: string;
}): string {
  const tlvPairs = [
    encodeTLV(1, params.sellerName),
    encodeTLV(2, params.vatNumber),
    encodeTLV(3, params.timestamp),
    encodeTLV(4, params.totalAmount),
    encodeTLV(5, params.vatAmount),
  ];
  return Buffer.concat(tlvPairs).toString('base64');
}
