# Document Upload Guide

## Overview
The document upload feature is now fully integrated into the TeleConnect test automation. It allows you to upload ID documents during the order registration process.

## Available Test Documents

Located in `/resources/` folder:

| Document Type | Filename | Size | Format |
|---|---|---|---|
| Aadhaar Card | `Aadhar.png` | 101 KB | PNG |
| PAN Card | `PAN_Card.png` | 101 KB | PNG |
| Passport | `Passport.png` | 101 KB | PNG |
| Driving License | `DrivingLicense.png` | 101 KB | PNG |

## Usage

### 1. Basic Document Upload in Feature File

```gherkin
When I upload ID document 'Aadhar.png'
Then Step 1 ID document should be uploaded
```

### 2. Using Different Document Types

```gherkin
# Upload Aadhaar Card
When I upload ID document 'Aadhar.png'

# Upload PAN Card
When I upload ID document 'PAN_Card.png'

# Upload Passport
When I upload ID document 'Passport.png'

# Upload Driving License
When I upload ID document 'DrivingLicense.png'
```

### 3. Step Definition

The step is defined in `src/steps/WebSteps.ts`:

```typescript
When(
  /^I upload ID document ['"](.+)['"]$/,
  async function (this: CustomWorld, fileName: string) {
    const path = require('path');
    const resourcePath = path.join(__dirname, '../../resources', fileName);
    await this.actionEngine.uploadFile(resourcePath, 'TeleConnect.UploadIdDocument');
    Logger.info(`Uploaded ID document: ${fileName}`);
  }
);
```

## How It Works

1. **Filename Resolution**: Pass only the filename (e.g., 'Aadhar.png')
2. **Path Resolution**: Automatically resolves to `/resources/{filename}`
3. **Element Targeting**: Uses `TeleConnect.UploadIdDocument` element reference
4. **Logging**: Logs the upload action for audit trail

## Adding New Documents

To add new test documents:

```bash
# Copy existing document
cp resources/Aadhar.png resources/NewDocument.png

# Or create your own document and place it in resources/
```

Then use in feature file:
```gherkin
When I upload ID document 'NewDocument.png'
```

## Feature File Example

Complete example with all steps:

```gherkin
When I select 'Aadhaar' from combobox 'TeleConnect.SelectIdType'
And I enter '123456789012' into 'TeleConnect.InputIdNumber'
And I upload ID document 'Aadhar.png'
Then Step 1 ID document should be uploaded
And Step 1 filled values should be visible
```

## Validation

The upload is validated with:

```gherkin
Then Step 1 ID document should be uploaded
```

This step checks:
- Upload section is visible
- File input element exists
- Document was successfully attached

## Generic File Upload

For uploading files to any element:

```gherkin
When I upload file '/absolute/path/to/file.png' to 'ElementReference'
```

Example:
```gherkin
When I upload file '/Users/premkumar/testusplay/resources/Aadhar.png' to 'TeleConnect.UploadIdDocument'
```

## Supported File Formats

Based on application constraints:
- **JPEG** (.jpg, .jpeg)
- **PNG** (.png)
- **PDF** (.pdf)

## Running Tests with Document Upload

```bash
# Run full test with document upload
HEADLESS=false npm test -- --tags @teleconnect

# Run only Step 1 (registration with document)
npm test -- features/web/teleconnect.feature -n "Step 1"
```

## Troubleshooting

### Document Not Found
```
Error: ENOENT: no such file or directory...
```
**Solution**: Ensure document exists in `/resources/` folder

### Upload Fails
```
Element not found: "TeleConnect.UploadIdDocument"
```
**Solution**: Verify element reference is defined in `TeleConnect.properties`

### File Too Large
```
Error: File size exceeds limit
```
**Solution**: Use smaller images (current test images are 101 KB)

## Best Practices

✅ **Do:**
- Use consistent filename format (CamelCase or snake_case)
- Create separate test documents for different ID types
- Add clear comments in feature files about document type
- Validate upload success before proceeding

❌ **Don't:**
- Use absolute paths in feature files (use filename only)
- Mix different test data in same document
- Upload large files (keep under 1 MB recommended)

## Resources

- **Upload Step**: `src/steps/WebSteps.ts` - lines 128-136
- **Validation Step**: `src/steps/TeleConnectValidation.ts` - lines 64-82
- **Element Reference**: `src/pages/properties/TeleConnect.properties` - `UploadIdDocument`
- **Test Documents**: `resources/` folder
- **Feature File**: `features/web/teleconnect.feature` - Step 1 section

## Example Test Run

```bash
$ HEADLESS=false npm test -- --tags @teleconnect

...
Given I navigate to the application
When I click 'TeleConnect.SwitchToRegister'
  ...
  And I select 'Aadhaar' from combobox 'TeleConnect.SelectIdType'
  And I enter '123456789012' into 'TeleConnect.InputIdNumber'
  And I upload ID document 'Aadhar.png'
  ✓ Uploaded ID document: Aadhar.png
  ✓ Document upload successful
Then Step 1 ID document should be uploaded
  ✓ Document uploaded (1 file(s))
...
```

## See Also

- [Real Validations Summary](./REAL_VALIDATIONS_SUMMARY.md)
- [Dropdown Selection Fix](./src/core/ActionEngine.ts#L232)
- [Framework Configuration](./src/config/framework.properties)
