const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const XML_AMPERSAND_PATTERN = /&/g;
const XML_LESS_THAN_PATTERN = /</g;
const XML_GREATER_THAN_PATTERN = />/g;
const XML_DOUBLE_QUOTE_PATTERN = /"/g;
const XML_SINGLE_QUOTE_PATTERN = /'/g;

export function createXmlDocument(rootElement: string): string {
  return `${XML_DECLARATION}\n${rootElement}`;
}

export function createXmlElement(name: string, value: string): string {
  return `<${name}>${escapeXml(value)}</${name}>`;
}

export function escapeXml(value: string): string {
  return value
    .replace(XML_AMPERSAND_PATTERN, "&amp;")
    .replace(XML_LESS_THAN_PATTERN, "&lt;")
    .replace(XML_GREATER_THAN_PATTERN, "&gt;")
    .replace(XML_DOUBLE_QUOTE_PATTERN, "&quot;")
    .replace(XML_SINGLE_QUOTE_PATTERN, "&apos;");
}
