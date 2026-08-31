# Agent Pipeline — Demo Commands

All commands to run the Planner + Generator for each user story.

---

## 1. TeleConnect - Order History (our app)

```bash
npm run agent:plan -- --story OrderHistory_Story.md --page OrderHistory
npm run agent:generate -- --plan "generated/plans/OrderHistory-plan_from_OrderHistory_Story.json"
```

---

## 2. AutomationExercise - Product Search & Cart

```bash
npm run agent:plan -- --story ProductSearchAndCart_Story.md --page ProductSearch
npm run agent:generate -- --plan "generated/plans/ProductSearch-plan_from_ProductSearchAndCart_Story.json"
```

---

## 3. Flipkart - Smartphone Search

```bash
npm run agent:plan -- --story FlipkartSmartphoneSearch_Story.md --page FlipkartSearch
npm run agent:generate -- --plan "generated/plans/FlipkartSearch-plan_from_FlipkartSmartphoneSearch_Story.json"
```

---

## 4. Flipkart - Category Navigation

```bash
npm run agent:plan -- --story FlipkartCategoryNavigation_Story.md --page FlipkartCategory
npm run agent:generate -- --plan "generated/plans/FlipkartCategory-plan_from_FlipkartCategoryNavigation_Story.json"
```

---

## 5. ParaBank - Login & Account Overview

```bash
npm run agent:plan -- --story ParaBankLogin_Story.md --page ParaBank
npm run agent:generate -- --plan "generated/plans/ParaBank-plan_from_ParaBankLogin_Story.json"
```

---

## 6. ParaBank - Transfer Funds

```bash
npm run agent:plan -- --story ParaBankTransfer_Story.md --page ParaBankTransfer
npm run agent:generate -- --plan "generated/plans/ParaBankTransfer-plan_from_ParaBankTransfer_Story.json"
```

---

## 7. ParaBank - Open New Account

```bash
npm run agent:plan -- --story ParaBankNewAccount_Story.md --page ParaBankAccount
npm run agent:generate -- --plan "generated/plans/ParaBankAccount-plan_from_ParaBankNewAccount_Story.json"
```

---

## 8. API - JSONPlaceholder CRUD

```bash
npm run agent:plan -- --story JSONPlaceholderAPI_Story.md --page JsonAPI
npm run agent:generate -- --plan "generated/plans/JsonAPI-plan_from_JSONPlaceholderAPI_Story.json"
```

---

## 9. API - Nested User/Comments (Deep JSON Paths)

```bash
npm run agent:plan -- --story DemoAPI_UserComments_Story.md --page DemoAPI
npm run agent:generate -- --plan "generated/plans/DemoAPI-plan_from_DemoAPI_UserComments_Story.json"
```

---

## 10. API - Todo Workflow (CRUD + Chained Requests)

```bash
npm run agent:plan -- --story DemoAPI_TodoWorkflow_Story.md --page TodoAPI
npm run agent:generate -- --plan "generated/plans/TodoAPI-plan_from_DemoAPI_TodoWorkflow_Story.json"
```

---

## Apply to Features Folder

Add `--apply` to any generate command to write directly:
- Web stories → `features/web/`
- API stories → `features/api/`

```bash
npm run agent:generate -- --plan "generated/plans/<plan-file>.json" --apply
```

---

## Run Tests After Apply

```bash
npm test
```

## Analyze Failures

```bash
npm run agent:heal
```

## Teleconnet
npx ts-node src/agents/planner/PlannerAgent.ts --story "requirements/stories/TeleConnect_OrderPlacement_Story.md" --page TeleConnect --url "https://telecom-app-171032253690.northamerica-northeast1.run.app/login"


npx ts-node src/agents/generator/GeneratorAgent.ts --plan "generated/plans/TeleConnect-plan_from_TeleConnect_OrderPlacement_Story.json" --apply
