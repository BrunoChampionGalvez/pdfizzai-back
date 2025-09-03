import * as fs from 'fs';

// Dynamic import for pdfjs-dist to handle ES module in CommonJS environment
let pdfjsLib: any;

async function initPdfJs() {
  if (!pdfjsLib) {
    // Use eval() to prevent TypeScript from transpiling dynamic import to require()
    const pdfjs = await (eval('import("pdfjs-dist/legacy/build/pdf.mjs")') as Promise<any>);
    pdfjsLib = pdfjs;
    // Configure PDF.js for Node.js environment
    // Don't set workerSrc - let PDF.js handle it internally
    // This should work without worker in Node.js environment
  }
  return pdfjsLib;
}

/**
 * Extract text from PDF using PDF.js
 * @param filePath Path to the PDF file
 * @returns Promise<string> Extracted text from all pages
 */
export async function extractTextFromPDF(filePath: string): Promise<string> {
  try {
    // Initialize PDF.js with dynamic import
    const pdfjs = await initPdfJs();

    // Read the PDF file as buffer
    const data = new Uint8Array(fs.readFileSync(filePath));

    // Load the PDF document
    const pdf = await pdfjs.getDocument({ data, disableWorker: true }).promise;
    const maxPages = pdf.numPages;

    const pageTextPromises: Promise<string>[] = [];

    // Extract text from each page
    for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
      pageTextPromises.push(getPageText(pdf, pageNo));
    }

    // Wait for all pages to be processed
    const pageTexts = await Promise.all(pageTextPromises);

    // Join all page texts with page separators
    return pageTexts.join('\n\n--- Page Break ---\n\n');
  } catch (error) {
    const message = (error as any)?.message ?? String(error);
    console.error('Error extracting text from PDF:', message);
    throw new Error(`Failed to extract text from PDF: ${message}`);
  }
}

/**
 * Extract text from a specific page
 * @param pdf PDF document object
 * @param pageNo Page number (1-indexed)
 * @returns Promise<string> Text content of the page
 */
async function getPageText(pdf: any, pageNo: number): Promise<string> {
  try {
    const page = await pdf.getPage(pageNo);
    const textContent = await page.getTextContent();

    // Extract text items and join them
    const pageText = textContent.items.map((item: any) => item.str).join(' ');

    return pageText;
  } catch (error) {
    const message = (error as any)?.message ?? String(error);
    console.error(`Error extracting text from page ${pageNo}:`, message);
    return ''; // Return empty string if page extraction fails
  }
}

/**
 * Extract text from PDF buffer (for uploaded files)
 * @param buffer PDF file buffer
 * @returns Promise<string> Extracted text from all pages
 */
export async function extractTextFromPDFBuffer(buffer: Buffer): Promise<string> {
  try {
    // Initialize PDF.js with dynamic import
    const pdfjs = await initPdfJs();

    // Convert buffer to Uint8Array
    const data = new Uint8Array(buffer);

    // Load the PDF document
    const pdf = await pdfjs.getDocument({ data, disableWorker: true }).promise;
    const maxPages = pdf.numPages;

    const pageTextPromises: Promise<string>[] = [];

    // Extract text from each page
    for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
      pageTextPromises.push(getPageText(pdf, pageNo));
    }

    // Wait for all pages to be processed
    const pageTexts = await Promise.all(pageTextPromises);

    // Join all page texts with page separators
    return pageTexts.join('\n\n--- Page Break ---\n\n');
  } catch (error) {
    const message = (error as any)?.message ?? String(error);
    console.error('Error extracting text from PDF buffer:', message);
    throw new Error(`Failed to extract text from PDF: ${message}`);
  }
}

/**
 * Get the number of pages in a PDF
 * @param buffer PDF file buffer
 * @returns Promise<number> Number of pages
 */
export async function getPDFPageCount(buffer: Buffer): Promise<number> {
  try {
    // Ensure pdfjs is initialized using the same dynamic import mechanism
    const pdfjs = await initPdfJs();
    const data = new Uint8Array(buffer);
    const pdf = await pdfjs.getDocument({ data, disableWorker: true }).promise;
    return pdf.numPages;
  } catch (error) {
    const message = (error as any)?.message ?? String(error);
    console.error('Error getting PDF page count:', message);
    throw new Error(`Failed to get PDF page count: ${message}`);
  }
}

/**
 * Extract text and page count from a PDF buffer in a single pass
 * This avoids parsing the PDF twice (once for text and once for page count).
 */
export async function extractTextAndPageCountFromPDFBuffer(
  buffer: Buffer
): Promise<{ text: string; totalPages: number }> {
  try {
    const pdfjs = await initPdfJs();
    const data = new Uint8Array(buffer);

    // Load the PDF document once
    const pdf = await pdfjs.getDocument({ data, disableWorker: true }).promise;
    const totalPages = pdf.numPages;

    const pageTextPromises: Promise<string>[] = [];
    for (let pageNo = 1; pageNo <= totalPages; pageNo++) {
      pageTextPromises.push(getPageText(pdf, pageNo));
    }

    const pageTexts = await Promise.all(pageTextPromises);
    const text = pageTexts.join('\n\n--- Page Break ---\n\n');

    return { text, totalPages };
  } catch (error) {
    const message = (error as any)?.message ?? String(error);
    console.error('Error extracting text and page count from PDF buffer:', message);
    throw new Error(
      `Failed to extract text and page count from PDF: ${message}`
    );
  }
}