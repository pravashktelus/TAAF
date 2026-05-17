import { Given, When, Then, DataTable } from '@cucumber/cucumber';
import { CustomWorld } from '../core/CustomWorld';
import { DataStore } from '../utils/DataStore';
import { Logger } from '../utils/Logger';

Given(
  /^I (?:am on|navigate to|open) (?:the )?(?:url |URL |page )?['"](.+)['"]$/,
  async function (this: CustomWorld, url: string) {
    await this.actionEngine.navigateTo(url);
  }
);

Given(
  /^I (?:am on|navigate to) the base url$/,
  async function (this: CustomWorld) {
    const fs = await import('fs');
    const path = await import('path');
    const ENV = (process.env.ENV as string) || 'qa';
    const configPath = path.join(__dirname, '../config/environments.json');
    const environments = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const config = environments[ENV];
    
    if (!config) {
      throw new Error(`Environment "${ENV}" not found in environments.json`);
    }
    
    await this.actionEngine.navigateTo(config.baseUrl);
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

Given(
  /^I set variable ['"](.+)['"] to ['"](.+)['"]$/,
  async function (this: CustomWorld, variableName: string, value: string) {
    DataStore.set(variableName, value);
    Logger.info(`Set variable "${variableName}" = "${value}"`);
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
