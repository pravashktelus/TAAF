import { Given, When, Then, DataTable } from '@cucumber/cucumber';
import { CustomWorld } from '../core/CustomWorld';
import { DataStore } from '../utils/DataStore';
import { PersistentStore } from '../utils/PersistentStore';
import { RandomDataGenerator } from '../utils/RandomDataGenerator';
import { FrameworkConfig } from '../config/FrameworkConfig';
import { Logger } from '../utils/Logger';

Given(
  /^I (?:am on|navigate to|open) (?:the )?(?:url |URL |page )?['"](.+)['"]$/,
  async function (this: CustomWorld, url: string) {
    await this.actionEngine.navigateTo(url);
  }
);

Given(
  /^I (?:am on|navigate to|open) the (?:application|app|base url)$/,
  async function (this: CustomWorld) {
    const config = FrameworkConfig.getInstance();
    const appUrl = config.get('app.url', '');
    if (!appUrl) {
      throw new Error('app.url not configured in framework.properties');
    }
    await this.actionEngine.navigateTo(appUrl);
  }
);

When(
  /^I go back$/,
  async function (this: CustomWorld) {
    await this.actionEngine.goBack();
  }
);

When(
  /^I go forward$/,
  async function (this: CustomWorld) {
    await this.actionEngine.goForward();
  }
);

When(
  /^I refresh the page$/,
  async function (this: CustomWorld) {
    await this.actionEngine.refreshPage();
  }
);

When(
  /^I click ['"](.+)['"]$/,
  async function (this: CustomWorld, elementRef: string) {
    await this.actionEngine.click(elementRef);
  }
);

When(
  /^I double click ['"](.+)['"]$/,
  async function (this: CustomWorld, elementRef: string) {
    await this.actionEngine.doubleClick(elementRef);
  }
);

When(
  /^I right click ['"](.+)['"]$/,
  async function (this: CustomWorld, elementRef: string) {
    await this.actionEngine.rightClick(elementRef);
  }
);

When(
  /^I enter ['"](.+)['"] into ['"](.+)['"]$/,
  async function (this: CustomWorld, value: string, elementRef: string) {
    await this.actionEngine.enter(value, elementRef);
  }
);

When(
  /^I type ['"](.+)['"] into ['"](.+)['"]$/,
  async function (this: CustomWorld, value: string, elementRef: string) {
    await this.actionEngine.clearAndType(value, elementRef);
  }
);

When(
  /^I clear ['"](.+)['"]$/,
  async function (this: CustomWorld, elementRef: string) {
    await this.actionEngine.enter('', elementRef);
  }
);

When(
  /^I press ['"](.+)['"](?: on ['"](.+)['"])?$/,
  async function (this: CustomWorld, key: string, elementRef?: string) {
    await this.actionEngine.pressKey(key, elementRef);
  }
);

When(
  /^I select ['"](.+)['"] (?:from|in) ['"](.+)['"]$/,
  async function (this: CustomWorld, value: string, elementRef: string) {
    await this.actionEngine.selectOption(value, elementRef);
  }
);

When(
  /^I select ['"](.+)['"] from (?:dropdown|combobox) ['"](.+)['"]$/,
  async function (this: CustomWorld, optionText: string, dropdownRef: string) {
    await this.actionEngine.selectComboboxOption(optionText, dropdownRef);
  }
);

When(
  /^I check ['"](.+)['"]$/,
  async function (this: CustomWorld, elementRef: string) {
    await this.actionEngine.check(elementRef);
  }
);

When(
  /^I uncheck ['"](.+)['"]$/,
  async function (this: CustomWorld, elementRef: string) {
    await this.actionEngine.uncheck(elementRef);
  }
);

When(
  /^I upload file ['"](.+)['"] to ['"](.+)['"]$/,
  async function (this: CustomWorld, filePath: string, elementRef: string) {
    await this.actionEngine.uploadFile(filePath, elementRef);
  }
);

When(
  /^I upload ID document ['"](.+)['"]$/,
  async function (this: CustomWorld, fileName: string) {
    const path = require('path');
    // Resolve path relative to project root
    const resourcePath = path.resolve(__dirname, '../../resources', fileName);
    Logger.info(`Uploading document: ${fileName} from ${resourcePath}`);
    await this.actionEngine.uploadFile(resourcePath, 'TeleConnect.UploadIdDocument');
    Logger.info(`✓ Uploaded ID document: ${fileName}`);
  }
);

When(
  /^I drag ['"](.+)['"] to ['"](.+)['"]$/,
  async function (this: CustomWorld, sourceRef: string, targetRef: string) {
    await this.actionEngine.dragAndDrop(sourceRef, targetRef);
  }
);

When(
  /^I hover (?:over )?['"](.+)['"]$/,
  async function (this: CustomWorld, elementRef: string) {
    await this.actionEngine.hover(elementRef);
  }
);

When(
  /^I scroll to ['"](.+)['"]$/,
  async function (this: CustomWorld, elementRef: string) {
    await this.actionEngine.scrollTo(elementRef);
  }
);

When(
  /^I scroll to (?:the )?(?:top|beginning) of (?:the )?page$/,
  async function (this: CustomWorld) {
    await this.actionEngine.scrollToTop();
  }
);

When(
  /^I scroll to (?:the )?bottom of (?:the )?page$/,
  async function (this: CustomWorld) {
    await this.actionEngine.scrollToBottom();
  }
);

When(
  /^I wait for ['"](.+)['"] to be (visible|hidden|attached|detached)$/,
  async function (this: CustomWorld, elementRef: string, state: string) {
    await this.actionEngine.waitForElement(elementRef, state as any);
  }
);

When(
  /^I wait (\d+) second(?:s)?$/,
  async function (this: CustomWorld, seconds: string) {
    await this.actionEngine.waitForSeconds(parseInt(seconds));
  }
);

When(
  /^I wait for (?:the )?url to contain ['"](.+)['"]$/,
  async function (this: CustomWorld, urlFragment: string) {
    await this.actionEngine.waitForNavigation(urlFragment);
  }
);

When(
  /^I store text of ['"](.+)['"] as ['"](.+)['"]$/,
  async function (this: CustomWorld, elementRef: string, variableName: string) {
    await this.actionEngine.storeText(elementRef, variableName);
  }
);

When(
  /^I store attribute ['"](.+)['"] of ['"](.+)['"] as ['"](.+)['"]$/,
  async function (this: CustomWorld, attribute: string, elementRef: string, variableName: string) {
    await this.actionEngine.storeAttribute(elementRef, attribute, variableName);
  }
);

Then(
  /^['"](.+)['"] should be visible$/,
  async function (this: CustomWorld, elementRef: string) {
    await this.actionEngine.assertVisible(elementRef);
  }
);

Then(
  /^['"](.+)['"] should (?:not be visible|be hidden)$/,
  async function (this: CustomWorld, elementRef: string) {
    await this.actionEngine.assertHidden(elementRef);
  }
);

Then(
  /^['"](.+)['"] should have text ['"](.+)['"]$/,
  async function (this: CustomWorld, elementRef: string, expectedText: string) {
    await this.actionEngine.assertText(elementRef, expectedText);
  }
);

Then(
  /^['"](.+)['"] should contain text ['"](.+)['"]$/,
  async function (this: CustomWorld, elementRef: string, expectedText: string) {
    await this.actionEngine.assertContainsText(elementRef, expectedText);
  }
);

Then(
  /^['"](.+)['"] should have value ['"](.+)['"]$/,
  async function (this: CustomWorld, elementRef: string, expectedValue: string) {
    await this.actionEngine.assertValue(elementRef, expectedValue);
  }
);

Then(
  /^['"](.+)['"] should be enabled$/,
  async function (this: CustomWorld, elementRef: string) {
    await this.actionEngine.assertEnabled(elementRef);
  }
);

Then(
  /^['"](.+)['"] should be disabled$/,
  async function (this: CustomWorld, elementRef: string) {
    await this.actionEngine.assertDisabled(elementRef);
  }
);

Then(
  /^['"](.+)['"] should be checked$/,
  async function (this: CustomWorld, elementRef: string) {
    await this.actionEngine.assertChecked(elementRef);
  }
);

Then(
  /^['"](.+)['"] should have (\d+) items?$/,
  async function (this: CustomWorld, elementRef: string, count: string) {
    await this.actionEngine.assertCount(elementRef, parseInt(count));
  }
);

Then(
  /^the page title should (?:be|equal) ['"](.+)['"]$/,
  async function (this: CustomWorld, expectedTitle: string) {
    await this.actionEngine.assertPageTitle(expectedTitle);
  }
);

Then(
  /^the (?:page )?url should contain ['"](.+)['"]$/,
  async function (this: CustomWorld, expectedUrl: string) {
    await this.actionEngine.assertPageUrl(expectedUrl);
  }
);

Then(
  /^['"](.+)['"] should have attribute ['"](.+)['"] with value ['"](.+)['"]$/,
  async function (
    this: CustomWorld,
    elementRef: string,
    attribute: string,
    expectedValue: string
  ) {
    await this.actionEngine.assertAttribute(elementRef, attribute, expectedValue);
  }
);

When(
  /^I take a screenshot(?: named ['"](.+)['"])?$/,
  async function (this: CustomWorld, name?: string) {
    const screenshot = await this.actionEngine.takeScreenshot(name);
    await this.attach(screenshot, 'image/png');
  }
);

When(
  /^I accept the (?:alert|dialog)$/,
  async function (this: CustomWorld) {
    await this.actionEngine.acceptAlert();
  }
);

When(
  /^I dismiss the (?:alert|dialog)$/,
  async function (this: CustomWorld) {
    await this.actionEngine.dismissAlert();
  }
);

When(
  /^I fill (?:the )?form:?$/,
  async function (this: CustomWorld, dataTable: DataTable) {
    const rows = dataTable.raw();
    for (const [elementRef, value] of rows) {
      await this.actionEngine.enter(value, elementRef);
    }
  }
);

When(
  /^I click (?:the )?following elements:?$/,
  async function (this: CustomWorld, dataTable: DataTable) {
    const rows = dataTable.raw();
    for (const [elementRef] of rows) {
      await this.actionEngine.click(elementRef);
    }
  }
);

// Get text from element and persist to JSON file for cross-scenario access via $$VariableName
When(
  /^I get text from ['"](.+)['"] and store as ['"](.+)['"]$/,
  async function (this: CustomWorld, elementRef: string, variableName: string) {
    const text = await this.actionEngine.getText(elementRef);
    DataStore.set(variableName, text);
    PersistentStore.save(variableName, text);
    Logger.info(`Stored "${text}" as "${variableName}" (persistent — use $$${variableName})`);
  }
);

// Persist a variable to JSON file for cross-scenario access
When(
  /^I persist ['"](.+)['"] as ['"](.+)['"]$/,
  async function (this: CustomWorld, value: string, variableName: string) {
    const resolved = value.replace(/\{(\w+)\}/g, (_, k) => String(DataStore.get(k) ?? `{${k}}`));
    PersistentStore.save(variableName, resolved);
    Logger.info(`Persisted "${resolved}" as "${variableName}" (use $$${variableName})`);
  }
);

// Use $$variable from persistent store in enter step (auto-resolved via resolveValue)
// Example: I enter '$$OrderId' into 'Search.Field'
// This is handled automatically by resolveValue in ActionEngine

// Generate random data using ##FieldName syntax
// Example: I enter '##FirstName' into 'Form.FirstName'
// Supported: ##FirstName, ##LastName, ##FullName, ##Email, ##MobileNum, ##PhoneNum,
//            ##Address, ##City, ##State, ##ZipCode, ##Country, ##Company,
//            ##JobTitle, ##Username, ##Password
// This is handled automatically by resolveValue in ActionEngine

// Verify CSS color of an element's text (supports named colors: red, green, blue, orange)
Then(
  /^['"](.+)['"] should have (?:text )?color ['"](.+)['"]$/,
  async function (this: CustomWorld, elementRef: string, expectedColor: string) {
    await this.actionEngine.assertCssColor(elementRef, 'color', expectedColor);
  }
);

// Attach a stored variable value to the test report for visibility
Then(
  /^I attach ['"](.+)['"] to (?:the )?report as ['"](.+)['"]$/,
  async function (this: CustomWorld, variableName: string, label: string) {
    const value = String(DataStore.get(variableName) ?? `Variable "${variableName}" not found`);
    const reportEntry = `${label}: ${value}`;
    await this.attach(reportEntry, 'text/plain');
    Logger.info(`📎 Attached to report — ${reportEntry}`);
  }
);

// Execute JavaScript to modify DOM (for testing self-healing scenarios)
Then(
  /^I execute script to change button text$/,
  async function (this: CustomWorld) {
    const page = this.getPage();
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="btn-new-connection"]');
      if (btn) {
        btn.textContent = 'Apply Connection';
        btn.setAttribute('data-testid', 'btn-apply-connection');
      }
    });
    Logger.info('Injected JS: Changed "New Connection" button to "Apply Connection" and modified data-testid');
  }
);
