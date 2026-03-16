const { getPage } = require('./browser');
const logger = require('../utils/logger');
const { delay } = require('../utils/delay');

// ─── Wait Helpers ─────────────────────────────────────────────────────────────

async function waitForElement(selector, timeout = 10000, interval = 1000) {
  let elapsed = 0;
  while (elapsed < timeout) {
    const found = await getPage().evaluate((sel) => !!document.querySelector(sel), selector);
    if (found) return true;
    await delay(interval);
    elapsed += interval;
  }
  throw new Error(`Element "${selector}" not found after ${timeout / 1000}s`);
}

async function waitForNavigation() {
  await getPage().waitForNavigation({ waitUntil: 'networkidle2' });
}

// ─── Click Actions ────────────────────────────────────────────────────────────

async function click(selector) {
  await waitForElement(selector);
  logger.debug(`Clicking: ${selector}`);
  await getPage().click(selector);
}

async function clickWithEvaluate(selector) {
  logger.debug(`Clicking via evaluate: ${selector}`);
  await getPage().evaluate((sel) => document.querySelector(sel).click(), selector);
}

// ─── Input Actions ────────────────────────────────────────────────────────────

async function typeInto(selector, text) {
  await waitForElement(selector);
  await getPage().focus(selector);
  await getPage().evaluate((sel) => { document.querySelector(sel).value = ''; }, selector);
  await getPage().type(selector, text);
  logger.debug(`Typed into ${selector}`);
}

async function uploadFile(filePath, selectorInput = "input[type='file']") {
  await waitForElement(selectorInput);
  const input = await getPage().$(selectorInput);
  if (!input) throw new Error(`Upload input not found: ${selectorInput}`);
  await input.uploadFile(filePath);
  logger.debug(`Uploaded file "${filePath}" to ${selectorInput}`);
}

// ─── Read Actions ─────────────────────────────────────────────────────────────

async function elementExists(selector) {
  return getPage().evaluate((sel) => !!document.querySelector(sel), selector);
}

async function getTextContent(selector) {
  return getPage().evaluate((sel) => document.querySelector(sel).innerText, selector);
}

// ─── Upload Process ───────────────────────────────────────────────────────────

async function waitForUploadProcess(selector, content, interval = 500, timeout = 10000) {
  let elapsed = 0;
  while (elapsed < timeout) {
    const text = await getTextContent(selector);
    if (text.toLowerCase().includes('\t') && !text.toLowerCase().includes(content)) {
      return text;
    }
    await delay(interval);
    elapsed += interval;
  }
  throw new Error(`Upload process content "${content}" not found after ${timeout / 1000}s`);
}

module.exports = {
  waitForElement,
  waitForNavigation,
  click,
  clickWithEvaluate,
  typeInto,
  uploadFile,
  elementExists,
  getTextContent,
  waitForUploadProcess,
};
