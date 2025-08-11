import * as fs from 'fs';

// Dynamic import for pdfjs-dist to handle ES module in CommonJS environment
let pdfjsLib: any;

async function initPdfJs() {
  if (!pdfjsLib) {
    pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    // Configure PDF.js for Node.js environment
    // Use a relative path approach that works in both local and deployed environments
    try {
      // Try to import the worker module to ensure it exists
      await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
      // Set worker source to the module path
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs';
    } catch (error) {
      console.warn('Could not load PDF worker, PDF processing may be slower:', error);
      // Fallback: disable worker
      pdfjsLib.GlobalWorkerOptions.workerSrc = null;
    }
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
    const pdf = await pdfjs.getDocument({ data }).promise;
    const maxPages = pdf.numPages;
    
    console.log(`PDF has ${maxPages} pages`);
    
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
    console.error('Error extracting text from PDF:', error);
    throw new Error(`Failed to extract text from PDF: ${error.message}`);
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
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(' ');
    
    return pageText;
  } catch (error) {
    console.error(`Error extracting text from page ${pageNo}:`, error);
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
    const pdf = await pdfjs.getDocument({ data }).promise;
    const maxPages = pdf.numPages;
    
    console.log(`PDF has ${maxPages} pages`);
    
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
    console.error('Error extracting text from PDF buffer:', error);
    throw new Error(`Failed to extract text from PDF: ${error.message}`);
  }
}

/**
 * Get the number of pages in a PDF
 * @param buffer PDF file buffer
 * @returns Promise<number> Number of pages
 */
export async function getPDFPageCount(buffer: Buffer): Promise<number> {
  try {
    const data = new Uint8Array(buffer);
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    return pdf.numPages;
  } catch (error) {
    console.error('Error getting PDF page count:', error);
    throw new Error(`Failed to get PDF page count: ${error.message}`);
  }
}