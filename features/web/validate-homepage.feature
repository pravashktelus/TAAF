@web @teleconnect_homepage
Feature: TeleConnect - Validate Home Page
    As a user
    I want to verify the home page loads correctly
    So that I can confirm the application is accessible

    @smoke @homepage
    Scenario: Home page should display the broadband heading
        Given I navigate to the application

        # ═══ Validate Home Page Heading ═══
        Then 'ValidateHomepage.BroadbandHeading' should be visible
        And 'ValidateHomepage.BroadbandHeading' should contain text 'High-Speed Broadband'
