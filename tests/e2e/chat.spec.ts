import { test, expect } from '@playwright/test';
import { createProject, projectJson } from './helpers';

// The e2e server has no LLM key, so the refine response is mocked in the browser.
// (The real endpoint → provider → compiler path is covered by tests/integration.)
test('ask for a change in the chat, review it, and apply it', async ({ page }) => {
  const { id } = await createProject(page, 'Chat e2e');

  // Build the proposal the server would return: add a dishwasher on the north wall.
  await page.route(`**/api/projects/${id}/refine`, async (route) => {
    const body = route.request().postDataJSON();
    expect(body).toEqual({ message: 'add a dishwasher on the north wall', history: [] });
    await route.fulfill({
      json: {
        commands: [{ type: 'addItem', catalogId: 'dishwasher-600', wall: 'w1', alongMm: 1500 }],
        patch: [
          {
            op: 'add',
            path: '/items/0',
            value: {
              id: '0f0e8f3e-9f5e-4b1b-9d53-2f5e2c9a1a11',
              catalogId: 'dishwasher-600',
              sizeMm: { w: 600, d: 580, h: 850 },
              clearanceMm: { front: 750, sides: 0 },
              tag: 'dishwasher',
              position: { x: 1500, y: 290 },
              rotationDeg: 0,
            },
          },
        ],
        summary: 'Add a dishwasher on the north wall',
        reply: 'Added a 600 mm dishwasher, centred on the north wall.',
        warnings: [],
        baseRevision: 0,
      },
    });
  });

  await page.getByLabel('Ask for a change').fill('add a dishwasher on the north wall');
  await page.getByLabel('Ask for a change').press('Enter');

  const review = page.getByRole('region', { name: 'Review proposed change' });
  await expect(review.getByRole('heading', { name: 'Add a dishwasher on the north wall' })).toBeVisible();
  await expect(review.getByText('dishwasher-600 at (1500, 290)')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Conversation' })).toContainText('Added a 600 mm dishwasher');
  expect(projectJson(id).items).toEqual([]); // not applied yet

  await review.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Revision 1')).toBeVisible();
  const saved = projectJson(id);
  expect(saved.items[0]).toMatchObject({ catalogId: 'dishwasher-600', position: { x: 1500, y: 290 } });
  expect(saved.history[0]).toMatchObject({ source: 'llm', summary: 'Add a dishwasher on the north wall' });
});

test('without an LLM key, the chat explains that edits still work by hand', async ({ page }) => {
  await createProject(page, 'Chat no key');
  await page.getByLabel('Ask for a change').fill('add a fridge');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('list', { name: 'Conversation' })).toContainText(/LLM_API_KEY is not set.*by hand/);
});
