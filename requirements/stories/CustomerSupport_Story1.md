Keep this as a single requirement
User Story Title: Create Customer Support Ticket
Subject: As a customer, I want to raise a support ticket from my Orders page, so that I can get help with technical or non-technical issues.
Description: Customer should be able to raise a support ticket for any kind of support needed from the customer support team. The "Support" button is available on the /customer/orders page under order details. This functionality enables customers to get help handling any technical or non-technical issues while using broadband internet service.
Page: https://simulapp.online/customer/orders
Flow: Login → Navigate to Orders page → Click "View Details" → Click "Support" button → Fill "Create Support Ticket" popup form → Submit → Verify ticket is created and visible in Support Tickets list.
Acceptance Criteria
1.	Customer Authentication: The customer can log in using the persisted credentials (Email and Password) from the data store.
2.	UI Navigation: On the Orders page (/customer/orders), clicking View Details expands the order view to display the Support & Issues section.
3.	Ticket Form Submission: Clicking the Support button opens a dialog box where the customer can fill out the form and submit it to the support team.
4.	Ticket Generation: Upon submission, the system generates a unique Ticket ID and displays a success message.
5.	Scope: One happy path scenario covering successful ticket creation. Negative and validation test cases are out of scope.


