# Stories

Drop your BA user stories and functional descriptions here.

## Supported Formats
- `.md` — Markdown story with acceptance criteria
- `.txt` — Plain text story
- `.docx` — Word document from BA/PO
- `.pdf` — PDF story document

## Usage
```bash
npm run agent:plan -- --story orders-creation.md --page Orders
npm run agent:plan -- --story orders-creation.md --url https://app.com/orders --page Orders
```

## Attachments
If your story has supporting documents (mockups, flow diagrams, business rules):
- Create a subfolder under `attachments/` with the **same name as your story file** (without extension)
- Drop all supporting files there

```
stories/
├── orders-creation.md
└── attachments/
    └── orders-creation/          ← same name as story file
        ├── mockup-order-form.png
        └── business-rules.docx
```

The Planner will automatically detect and include attachments when generating test cases.
