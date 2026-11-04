/** Exercise the visible app picker while using its native value bridge to locate options. */
export async function pickSelect(select, value) {
  const label = await select.locator('option').evaluateAll((options, value) => options.find(o => o.value === value)?.textContent, value);
  if (label === undefined) throw new Error(`Select option not found: ${value}`);
  await select.locator('xpath=following-sibling::button[1]').click();
  await select.page().getByRole('option', { name: label.trim(), exact: true }).click();
}

export async function pickDate(input, value) {
  const page = input.page();
  const month = await input.evaluate(el => el.value ? Number(el.value.slice(5, 7)) - 1 : new Date().getMonth());
  await input.locator('xpath=following-sibling::button[1]').click();
  await page.locator('.app-calendar-head input').fill(value.slice(0, 4));
  const distance = Number(value.slice(5, 7)) - 1 - month;
  const navigation = page.locator('.app-calendar-head > button').nth(distance < 0 ? 0 : 1);
  for (let i = 0; i < Math.abs(distance); i++) await navigation.click();
  await page.getByRole('button', { name: value, exact: true }).click();
}
