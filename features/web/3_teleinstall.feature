@web @teleconnect_install
Feature: 3_TeleConnect - Installation Process for Approved Orders
    As an installation technician
    I want to schedule and complete broadband installations
    So that customers get their connections activated on time

    @smoke @e2e
    Scenario: Install Team - Schedule and Complete Installation for Approved Order
        Given I navigate to the application

        # ═══ Login to Install Application - Positive Flow ═══
        When 'TeleInstall.InstallButton' should be visible
        Then I click 'TeleInstall.InstallButton'
        And I click 'TeleInstall.LoginSubmit'
        And 'TeleInstall.InstallHomePage' should be visible

        # ═══ Verify Order Card is Visible (Dynamic) ═══
        Then order containing '$$OrderId' should be visible

        # ═══ Schedule Installation - Positive Flow ═══
        When I click 'TeleInstall.InstallScheduleButton' in order containing '$$OrderId'
        And I enter '2026-09-15' into 'TeleInstall.InstallScheduleDate'
        And I select 'Morning (9 AM - 12 PM)' from 'TeleInstall.InstallSlotSelect'
        And I enter '##FullName' into 'TeleInstall.InstallTechnicianName'
        And I click 'TeleInstall.InstallConfirmSchedule'

        # ═══ Verify Scheduled Status ═══
        Then order containing '$$OrderId' should be visible
        And 'TeleInstall.InstallStatusScheduled' should be visible

        # ═══ Complete Installation - Positive Flow ═══
        When I click 'TeleInstall.InstallCompleteButton' in order containing '$$OrderId'
        And I click 'TeleInstall.InstallCheckCable'
        And I click 'TeleInstall.InstallCheckRouter'
        And I click 'TeleInstall.InstallCheckSpeed'
        And I click 'TeleInstall.InstallCheckSignoff'
        And I click 'TeleInstall.InstallConfirmComplete'

        # ═══ Logout ═══
        And I click 'TeleInstall.InstallLogout'
