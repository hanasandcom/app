import AppKit
import ApplicationServices
import Combine
import CryptoKit
import Darwin
import Foundation
import Network
import PDFKit
import SwiftUI
import UniformTypeIdentifiers
import WebKit

@MainActor
final class DesktopAgentModel: ObservableObject {
    static var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0"
    }

    @Published var prompt = ""; @Published var loginUsername = ""; @Published var loginPassword = ""; @Published var loginStatus = ""

    @Published var isLoggingIn = false; @Published var passwordResetUsername = ""; @Published var passwordResetCode = ""; @Published var passwordResetToken = ""

    @Published var passwordResetNewPassword = ""; @Published var passwordResetConfirmPassword = ""; @Published var passwordResetStatus = ""; @Published var passwordResetStep: PasswordResetStep = .idle

    @Published var pendingDeletionUserID = ""; @Published var pendingDeletionRestoreToken = ""; @Published var pendingDeletionScheduledAt = ""; @Published var pendingDeletionStatus = ""; @Published var isRestoringPendingDeletion = false

    @Published var isResettingPassword = false; @Published var promptQueue: [QueuedPrompt] = []; @Published var changedFileSummary: [ChangedFileSummary] = []; @Published var changedFileSummaryStatus = "Git not checked"

    @Published var events: [AgentEvent] = []; @Published var status = AgentStatus.ready(); @Published var selectedProject = "Hanasand Desktop"

    @Published var customProjectTitles: [String] = [] {
        didSet { UserDefaults.standard.set(customProjectTitles, forKey: Self.customProjectsKey) }
    }

    @Published var selectedSection: DesktopSection = .control {
        didSet { UserDefaults.standard.set(selectedSection.rawValue, forKey: Self.selectedSectionKey) }
    }

    @Published var settings: HanasandDesktopSettings {
        didSet { saveSettings() }
    }

    @Published var appearancePreference: AppearancePreference {
        didSet {
            UserDefaults.standard.set(appearancePreference.rawValue, forKey: Self.appearancePreferenceKey)
        }
    }

    @Published var focusCommand = false

    @Published var sidebarVisible = true {
        didSet { UserDefaults.standard.set(sidebarVisible, forKey: Self.sidebarVisibleKey) }
    }

    @Published var isRunning = false; @Published var currentTaskState = "Idle"

    @Published var runHistory: [ControlRun] = [] {
        didSet { saveRunHistory() }
    }

    @Published var pendingApproval: ControlApproval?; @Published var updateStatus = AppUpdateStatus.idle; @Published var updateManifest: AppUpdateManifest?; @Published var stagedUpdatePath: String?

    @Published var backgroundInstalledUpdateVersion = ""; @Published var mailSummary = "Ready to load inbox"; @Published var aiSummary = "Ready to connect"; @Published var aiMessages: [AIChatMessage] = []

    @Published var aiTrace: [AITraceEvent] = []; @Published var aiClients: [AIConnectedClient] = []; @Published var aiSocketConnected = false; @Published var aiRightRailMode: AIRightRailMode = .hidden

    @Published var aiInlineBrowserVisible = false; @Published var aiBrowserTab: BrowserTabState?; @Published var aiActiveConversationID: String?; @Published var aiRunStartedAt: Date?

    @Published var aiLastDuration = "No run yet"; @Published var browserOpenRequest: BrowserOpenRequest?; @Published var browserActiveAddress = "https://hanasand.com"; @Published var browserActiveTitle = "Hanasand"

    @Published var ideOpenRequest: IDEOpenRequest?; @Published var pendingIDEEdit: IDEPendingEdit?; @Published var serverSummary = "Not checked"; @Published var serverReachability: [ServerEndpointStatus] = []

    @Published var aiRateLimit: AIRateLimitSnapshot?; @Published var aiRateLimitClock = Date()

    @Published var isCheckingServerReachability = false; @Published var isRunningServerAction = false; @Published var serverActionStatus = "No server action running"; @Published var selectedDashboardPath: String?

    @Published var selectedDashboardTitle = "Dashboard"; @Published var nativeDashboardPayload = "Select a dashboard card to load native data."; @Published var nativeDashboardStatus = "Ready"; @Published var isLoadingNativeDashboard = false
    var nativeDashboardLoadID = UUID()

    @Published var backupServices: [DashboardBackupService] = []; @Published var backupFiles: [DashboardBackupFile] = []; @Published var notes: [DashboardNote] = []; @Published var selectedNoteID = ""

    @Published var noteDraftTitle = ""; @Published var noteDraftContent = ""; @Published var mailOverview: MailOverviewEnvelope?; @Published var selectedMailAccountUser = ""

    @Published var selectedMailMessageID = ""; @Published var selectedMailboxID = ""; @Published var mailComposeTo = ""; @Published var mailComposeCc = ""

    @Published var mailComposeBcc = ""; @Published var mailComposeReplyTo = ""; @Published var mailComposeSubject = ""; @Published var mailComposeBody = ""

    @Published var mailComposerExpanded = false; @Published var mailDraftAttachments: [MailDraftAttachment] = []; @Published var selectedMailMessageIDs: Set<String> = []; @Published var mailMoveTargetMailboxName = ""

    @Published var mailNewMailboxName = ""; @Published var mailFilterName = ""; @Published var mailFilterContains = ""; @Published var mailFilterTargetMailbox = ""

    @Published var mailLastSuccessAt: Date?; @Published var mailBackgroundIssue = ""; @Published var mailAutoRefreshEnabled = true; @Published var shares: [DashboardShare] = []

    @Published var shareDraftName = ""; @Published var shareDraftContent = ""; @Published var selectedShareID = ""; @Published var shareEditName = ""

    @Published var shareEditPath = ""; @Published var shareEditContent = ""; @Published var shareTrees: [String: [DashboardShareTreeItem]] = [:]; @Published var articles: [DashboardArticle] = []

    @Published var articleDraftID = ""; @Published var articleDraftContent = ""; @Published var selectedArticleID = ""; @Published var articleEditID = ""

    @Published var articleEditContent = ""; @Published var thoughts: [DashboardThought] = []; @Published var thoughtDraftTitle = ""; @Published var selectedThoughtID = ""

    @Published var thoughtEditTitle = ""; @Published var profile: DashboardProfile?; @Published var profileSessions: [DashboardAuthSession] = []; @Published var profileCertificates: [DashboardCertificate] = []

    @Published var users: [DashboardUser] = []; @Published var selectedUserID = ""; @Published var selectedUserRoles: [DashboardUserRoleAssignment] = []; @Published var roles: [DashboardRole] = []

    @Published var roleDraftID = ""; @Published var roleDraftName = ""; @Published var roleDraftDescription = ""; @Published var selectedRoleID = ""

    @Published var roleEditName = ""; @Published var roleEditDescription = ""; @Published var logs: [DashboardLogEntry] = []; @Published var dockerContainers: [DashboardDockerContainer] = []

    @Published var virtualMachines: [DashboardVM] = []; @Published var recentTests: [DashboardRecentTest] = []; @Published var testDraftURL = ""; @Published var testDraftTimeout = "30"

    @Published var testDraftStages = "30s:5, 1m:15"; @Published var selectedTestDetail: DashboardRecentTest?; @Published var serviceStatus: DashboardServiceStatus?; @Published var linkDraftID = ""

    @Published var linkDraftPath = ""; @Published var linkLookupID = ""; @Published var linkLookupResult: DashboardShortcutLink?; @Published var vulnerabilityReport: DashboardVulnerabilityReport?

    @Published var databaseOverview: DashboardDatabaseOverview?; @Published var trafficMetrics: DashboardTrafficMetrics?; @Published var rateLimitOverview: DashboardRateLimitOverview?; @Published var apiKeys: [DashboardApiKeySummary] = []

    @Published var rateLimitKeyOwnerID = ""; @Published var rateLimitKeyName = ""; @Published var rateLimitKeyTier = "starter"; @Published var rateLimitKeyRoute = ""

    @Published var rateLimitIssuedSecret: String?; @Published var rateLimitOverrideRoute = ""; @Published var rateLimitOverrideScope = "anonymous"; @Published var rateLimitOverrideWindowMs = "60000"

    @Published var rateLimitOverrideMaxRequests = "60"; @Published var uploadFileURL: URL?; @Published var uploadName = ""; @Published var uploadDescription = ""

    @Published var uploadPath = ""; @Published var uploadType = "application/octet-stream"; @Published var uploadStatus = "Choose a file to upload to the CDN."; @Published var uploadedFileURL = ""

    @Published var isUploadingFile = false; @Published var isCheckingUploadPath = false; @Published var uploadPathAvailable: Bool?; @Published var documentPages: [DesktopDocumentPage] = []

    @Published var documentStatus = "Import PDFs or images to build a document bundle."; @Published var exportedDocumentPath = ""; @Published var imageReviewItems: [DesktopImageReviewItem] = []; @Published var imageReviewIndex = 0

    @Published var imageReviewDecisions: [UUID: ImageReviewDecision] = [:]; @Published var imageReviewHistory: [UUID] = []; @Published var imageReviewStatus = "Import images to start a deferred delete review."; @Published var remoteControlSummary = "Ready for app control."

    @Published var remoteControlLastCommand = "None"; @Published var remoteControlRequests = 0

    static let appearancePreferenceKey = "hanasand.desktop.appearancePreference"
    static let settingsKey = "hanasand.desktop.settings"
    static let runHistoryKey = "hanasand.desktop.controlRunHistory"
    static let sidebarVisibleKey = "hanasand.desktop.sidebarVisible"
    static let selectedSectionKey = "hanasand.desktop.selectedSection"
    static let customProjectsKey = "hanasand.desktop.customProjects"
    static let backgroundInstalledUpdateVersionKey = "hanasand.desktop.backgroundInstalledUpdateVersion"
    static let deviceIdentifierKey = "hanasand.desktop.deviceIdentifier"

    var server: LoopbackAgentServer?
    var codexWorkerProcess: Process?
    var updateTask: Task<Void, Never>?
    var desktopPresenceTask: Task<Void, Never>?
    var aiSocketTask: URLSessionWebSocketTask?
    var aiReceiveTask: Task<Void, Never>?
    var aiSocketReconnectTask: Task<Void, Never>?
    var aiRateLimitTask: Task<Void, Never>?
    var aiSocketReconnectAttempt = 0
    var lastAutoVerifiedPasswordResetCode = ""

    init() {
        let saved = UserDefaults.standard.string(forKey: Self.appearancePreferenceKey)
        appearancePreference = AppearancePreference(rawValue: saved ?? "") ?? .system
        var restoredSettings: HanasandDesktopSettings
        if let data = UserDefaults.standard.data(forKey: Self.settingsKey),
           let decoded = try? JSONDecoder().decode(HanasandDesktopSettings.self, from: data) {
            restoredSettings = decoded
        } else {
            restoredSettings = HanasandDesktopSettings()
        }
        do {
            if let token = try DesktopCredentialStore.read(.authToken) {
                restoredSettings.authToken = token
            }
            if let token = try DesktopCredentialStore.read(.impersonationToken) {
                restoredSettings.impersonationToken = token
            }
        } catch {
            // Keep legacy UserDefaults values in memory and retry migration on the next save.
        }
        settings = restoredSettings
        if let apiBaseURL = ProcessInfo.processInfo.environment["HANASAND_DESKTOP_API_BASE_URL"],
           !apiBaseURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            settings.apiBaseURL = apiBaseURL
        }
        if UserDefaults.standard.object(forKey: Self.sidebarVisibleKey) != nil {
            sidebarVisible = UserDefaults.standard.bool(forKey: Self.sidebarVisibleKey)
        }
        if let savedSection = UserDefaults.standard.string(forKey: Self.selectedSectionKey) {
            if savedSection == "ai" {
                selectedSection = .command
            } else if let section = DesktopSection(rawValue: savedSection) {
                selectedSection = section
            }
        }
        customProjectTitles = UserDefaults.standard.stringArray(forKey: Self.customProjectsKey) ?? []
        let storedInstalledUpdateVersion = UserDefaults.standard.string(forKey: Self.backgroundInstalledUpdateVersionKey) ?? ""
        if storedInstalledUpdateVersion.isNewerVersion(than: Self.appVersion) {
            backgroundInstalledUpdateVersion = storedInstalledUpdateVersion
        } else if !storedInstalledUpdateVersion.isEmpty {
            UserDefaults.standard.removeObject(forKey: Self.backgroundInstalledUpdateVersionKey)
        }
        runHistory = Self.loadPersistedRunHistory()
        if let initialSection = ProcessInfo.processInfo.environment["HANASAND_DESKTOP_INITIAL_SECTION"],
           let section = DesktopSection(rawValue: initialSection) {
            selectedSection = section
        }
        if let initialDashboardPath = ProcessInfo.processInfo.environment["HANASAND_DESKTOP_INITIAL_DASHBOARD_PATH"],
           !initialDashboardPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            selectedSection = .dashboard
            selectedDashboardPath = initialDashboardPath
            selectedDashboardTitle = ProcessInfo.processInfo.environment["HANASAND_DESKTOP_INITIAL_DASHBOARD_TITLE"] ?? "Dashboard"
        }
        saveSettings()
    }

    var quickAppActions: [DesktopAction] {
        [
            .url("Hanasand", "Open the public website.", "safari", settings.websiteBaseURL),
            .route("Upload", "Native CDN file uploader.", "arrow.up.doc", "/upload"),
            .url("GitHub", "Open source repositories.", "chevron.left.forwardslash.chevron.right", "https://github.com/eirikhanasand"),
            .url("LinkedIn", "Open LinkedIn profile.", "person.text.rectangle", "https://linkedin.com/in/eirikhanasand"),
            .url("Mail", "Compose an email.", "paperplane", "mailto:eirik.hanasand@gmail.com"),
            .url("Discord", "Open Discord profile.", "bubble.left.and.bubble.right", "https://discordapp.com/users/376827396764073997"),
        ]
    }
}
