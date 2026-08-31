# User Story Title: Register and Place Broadband Connection Order

**Subject:** As a new customer, I want to register an account and place a broadband connection order so that I can get internet service at my home.

**Description:** New customers should be able to create an account and place a broadband order through a multi-step wizard.

**Page:** https://telecom-app-171032253690.northamerica-northeast1.run.app/login

**Page Name:** TeleConnect

**Flow:** Login Page → Register → Dashboard → New Connection → Step 1 (Customer Info) → Step 2 (Location) → Step 3 (Plan Selection) → Step 4 (Offers) → Step 5 (Schedule Installation) → Step 6 (Confirm & Submit) → Order Success




## Detailed Steps

### Step 1: Registration
- Navigate to `https://telecom-app-171032253690.northamerica-northeast1.run.app/login`
- Click the "Create an account" link
- Enter a full name into the "Full Name" field
- Enter an email into the "Email" field
- Enter a password into the "Password" field
- Click the "Create Account" button
- Verify the URL contains "customer"

### Step 2: Dashboard
- Verify the "Welcome Heading" is visible
- Verify "Total Orders" stat is visible
- Verify "In Progress" stat is visible
- Verify "Activated" stat is visible
- Click the "New Connection" button
- Verify the URL contains "order"

### Step 3: Order Step 1 - Customer Info
- Verify the "Step Badge" contains "Step 1"
- Enter a full name into the "Name" field
- Enter an email into the "Email" field
- Enter "1990-05-15" into the "DOB" field
- Select "Male" from the "Gender" dropdown
- Enter a phone number into the "Phone" field
- Enter a phone number into the "Alt Phone" field
- Enter an address into the "Address" field
- Select "Aadhaar" from the "ID Type" dropdown
- Enter "123456789012" into the "ID Number" field
- Click the "Next" button

### Step 4: Order Step 2 - Location
- Verify the "Step Badge" contains "Step 2"
- Select "Delhi" from the "State" dropdown
- Select "Delhi" from the "City" dropdown
- Select "Saket" from the "Area" dropdown
- Enter an address into the "Install Address" field
- Click the "Next" button

### Step 5: Order Step 3 - Plan Selection
- Verify the "Step Badge" contains "Step 3"
- Click the "WiFi Entertainment" plan card
- Click the "Next" button

### Step 6: Order Step 4 - Offers
- Verify the "Step Badge" contains "Step 4"
- Verify the "Price Summary" is visible
- Click the "None" offer option
- Click the "Next" button

### Step 7: Order Step 5 - Schedule Installation
- Verify the "Step Badge" contains "Step 5"
- Enter "2026-06-15" into the "Preferred Date" field
- Click the "Afternoon" time slot
- Enter "Ring doorbell twice" into the "Special Instructions" field
- Click the "Next" button

### Step 8: Order Step 6 - Confirm & Submit
- Verify the "Step Badge" contains "Step 6"
- Click the "Submit Order" button

### Step 9: Order Success
- Verify the "Order Success" section is visible
- Verify the "Order Number" is visible
- Verify the "Expected Date" is visible

## Acceptance Criteria

### AC-1: Register new account and place broadband order
- Navigate to the application
- Click "Create an account" link
- Enter name, email, password and submit registration
- Verify dashboard loads with order stats
- Click "New Connection" and complete all 6 steps of the order wizard
- Verify order is placed successfully with order number displayed

### AC-2: Validate all tabs mandatory fields
- Navigate to the application
- Do the login with valid credentials
- Verify dashboard loads with order stats
- Click "New Connection"
- Now verify all the mandatory fields available on differrent tabs Customer Info,Location,Plan Selection,Offers,Schedule Installation


