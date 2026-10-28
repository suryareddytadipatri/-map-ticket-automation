import { test, expect, Page } from '@playwright/test';
import { pathToFileURL } from 'url';
import path from 'path';

// index.html sits in the project root, next to package.json
const APP_URL = pathToFileURL(path.resolve('index.html')).href;

// ---------- helpers (written once, used many times) ----------
async function login(page: Page) {
  await page.getByLabel('Employee ID').fill('EMP1001');
  await page.getByLabel('Password').fill('Map@123');
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function claim(page: Page, id: string) {
  await page.getByLabel('Ticket ID').fill(id);
  await page.getByRole('button', { name: 'Claim' }).click();
}

// Steps 1 and 2 of the real work: pick case type, read policy, check resources
async function prepare(page: Page, caseType: string, resources: string[] = ['Street view']) {
  await page.getByLabel('Case type').selectOption({ label: caseType });
  await page.getByRole('button', { name: 'View policy' }).click();
  for (const r of resources) await page.getByLabel(r).check();
}

async function decide(page: Page, decision: string) {
  await page.getByRole('radio', { name: decision }).check();
}

const closeTicket = (page: Page) => page.getByRole('button', { name: 'Close ticket' }).click();

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
});

// ================= PART 1: LOGIN AND CLAIM =================

// TC01: valid login shows the workspace and the tickets allocated by the lead
test('TC01 login shows allocated tickets', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('heading', { name: 'Operator workspace' })).toBeVisible();
  await expect(page.locator('#welcome')).toHaveText('Welcome, Ravi Kumar (EMP1001)');
  await expect(page.locator('#queue tbody tr')).toHaveCount(6);
});

// TC02: wrong password is refused
test('TC02 wrong password shows an error', async ({ page }) => {
  await page.getByLabel('Employee ID').fill('EMP1001');
  await page.getByLabel('Password').fill('wrong123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Employee ID or password is incorrect.');
});

// TC03: paste a ticket ID in Calipso and claim it
test('TC03 claim a ticket shows the user concern', async ({ page }) => {
  await login(page);
  await claim(page, 'TCK-2202');
  await expect(page.locator('#ticket-status')).toHaveText('Claimed');
  await expect(page.locator('#concern')).toContainText('Route 66');
  await expect(page.locator('#queue tbody tr', { hasText: 'TCK-2202' })).toContainText('Claimed');
});

// TC04: a ticket that is not allocated to you cannot be claimed
test('TC04 unknown ticket cannot be claimed', async ({ page }) => {
  await login(page);
  await claim(page, 'TCK-0000');
  await expect(page.getByRole('alert')).toHaveText('Ticket TCK-0000 is not in your allocated list.');
});

// ================= PART 2: POLICY =================

// TC05: choosing the case type and viewing the policy shows the matching policy
test('TC05 policy page matches the case type', async ({ page }) => {
  await login(page);
  await claim(page, 'TCK-3303');
  await prepare(page, 'Road closure');
  await expect(page.locator('#policy-title')).toHaveText('Policy: Road closure');
});

// ================= PART 3: GENUINE CONCERNS (all five case types) =================

// TC06: highway
test('TC06 genuine highway concern is resolved', async ({ page }) => {
  await login(page);
  await claim(page, 'TCK-2202');
  await prepare(page, 'Highway', ['Official website']);
  await decide(page, 'Concern is genuine');
  await page.getByLabel('New highway name').fill('Route 66');
  await closeTicket(page);
  await expect(page.getByRole('status')).toHaveText('Ticket TCK-2202 closed');
  await expect(page.locator('#result')).toHaveText('Resolved: Highway renamed to Route 66');
});

// TC07: address
test('TC07 genuine address concern is resolved', async ({ page }) => {
  await login(page);
  await claim(page, 'TCK-1101');
  await prepare(page, 'Address', ['Street view', 'Imagery']);
  await decide(page, 'Concern is genuine');
  await page.getByLabel('Corrected address').fill('12B Lake View Road');
  await closeTicket(page);
  await expect(page.locator('#result')).toHaveText('Resolved: Address changed to 12B Lake View Road');
});

// TC08: road closure
test('TC08 genuine road closure is added', async ({ page }) => {
  await login(page);
  await claim(page, 'TCK-3303');
  await prepare(page, 'Road closure', ['Official website']);
  await decide(page, 'Concern is genuine');
  await page.getByLabel('Closure action').selectOption('add');
  await closeTicket(page);
  await expect(page.locator('#result')).toHaveText('Resolved: Closure added');
});

// TC09: road development
test('TC09 genuine road development is added', async ({ page }) => {
  await login(page);
  await claim(page, 'TCK-4404');
  await prepare(page, 'Road development', ['Imagery']);
  await decide(page, 'Concern is genuine');
  await page.getByLabel('New road name').fill('Maple Link');
  await closeTicket(page);
  await expect(page.locator('#result')).toHaveText('Resolved: New road added: Maple Link');
});

// TC10: road removal
test('TC10 genuine road removal is done', async ({ page }) => {
  await login(page);
  await claim(page, 'TCK-5505');
  await prepare(page, 'Road removal', ['Imagery', 'Street view']);
  await decide(page, 'Concern is genuine');
  await page.getByLabel('Road to remove').fill('Old Mill Road');
  await closeTicket(page);
  await expect(page.locator('#result')).toHaveText('Resolved: Road removed: Old Mill Road');
});

// ================= PART 4: FAKE CONCERN =================

// TC11: fake concern: keep the data, write a comment, close
test('TC11 fake concern is closed with a comment and no change', async ({ page }) => {
  await login(page);
  await claim(page, 'TCK-6606');
  await prepare(page, 'Highway', ['Official website', 'Street view']);
  await decide(page, 'Concern is fake or not supported');
  await expect(page.getByLabel('New highway name')).toBeHidden();
  await page.getByLabel('Comment').fill('Official website still shows Airport Road. No evidence of rename.');
  await closeTicket(page);
  await expect(page.locator('#result')).toHaveText('No change made. Data kept as it is.');
  await expect(page.locator('#saved-comment')).toContainText('Official website still shows Airport Road');
  await expect(page.locator('#queue tbody tr', { hasText: 'TCK-6606' })).toContainText('Closed');
});

// ================= PART 5: RULES THAT BLOCK CLOSING =================

// TC12: fake concern with no comment is blocked
test('TC12 fake concern needs a comment', async ({ page }) => {
  await login(page);
  await claim(page, 'TCK-6606');
  await prepare(page, 'Highway');
  await decide(page, 'Concern is fake or not supported');
  await closeTicket(page);
  await expect(page.getByRole('alert')).toHaveText('Write a comment before closing the ticket.');
  await expect(page.locator('#ticket-status')).toHaveText('Claimed');
});

// TC13: the policy must be read first
test('TC13 cannot close before viewing the policy', async ({ page }) => {
  await login(page);
  await claim(page, 'TCK-2202');
  await page.getByLabel('Case type').selectOption({ label: 'Highway' });
  await page.getByLabel('Street view').check();
  await decide(page, 'Concern is genuine');
  await page.getByLabel('New highway name').fill('Route 66');
  await closeTicket(page);
  await expect(page.getByRole('alert')).toHaveText('View the policy before closing the ticket.');
});

// TC14: at least one resource must be checked
test('TC14 cannot close without checking a resource', async ({ page }) => {
  await login(page);
  await claim(page, 'TCK-2202');
  await prepare(page, 'Highway', []);
  await decide(page, 'Concern is genuine');
  await page.getByLabel('New highway name').fill('Route 66');
  await closeTicket(page);
  await expect(page.getByRole('alert')).toHaveText('Check at least one resource.');
  
});
