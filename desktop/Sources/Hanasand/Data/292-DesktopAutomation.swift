import Foundation

struct DesktopAutomation: Decodable, Identifiable {
    let id: String
    let name: String
    let prompt: String
    let actionType: String
    let targetUrl: String?
    let monitoringType: String
    let scheduleKind: String
    let intervalMinutes: Int?
    let status: String
    let lastStatus: String?
    let lastRunAt: String?
    let nextRunAt: String?
    let lastResult: String?
    let lastError: String?
    let runCount: Int
    let consecutiveFailures: Int

    var resultSummary: String? { lastError ?? lastResult }

    enum CodingKeys: String, CodingKey {
        case id, name, prompt, actionType, targetUrl, monitoringType, scheduleKind, intervalMinutes, status
        case lastStatus, lastRunAt, nextRunAt, lastResult, lastError, runCount, consecutiveFailures
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        name = try values.decode(String.self, forKey: .name)
        prompt = try values.decodeIfPresent(String.self, forKey: .prompt) ?? ""
        actionType = try values.decodeIfPresent(String.self, forKey: .actionType) ?? "agent_prompt"
        targetUrl = try values.decodeIfPresent(String.self, forKey: .targetUrl)
        monitoringType = try values.decodeIfPresent(String.self, forKey: .monitoringType) ?? "fetch"
        scheduleKind = try values.decodeIfPresent(String.self, forKey: .scheduleKind) ?? "interval"
        intervalMinutes = try values.decodeIfPresent(Int.self, forKey: .intervalMinutes)
        status = try values.decodeIfPresent(String.self, forKey: .status) ?? "paused"
        lastStatus = try values.decodeIfPresent(String.self, forKey: .lastStatus)
        lastRunAt = try values.decodeIfPresent(String.self, forKey: .lastRunAt)
        nextRunAt = try values.decodeIfPresent(String.self, forKey: .nextRunAt)
        lastResult = try values.decodeIfPresent(String.self, forKey: .lastResult)
        lastError = try values.decodeIfPresent(String.self, forKey: .lastError)
        runCount = try values.decodeIfPresent(Int.self, forKey: .runCount) ?? 0
        consecutiveFailures = try values.decodeIfPresent(Int.self, forKey: .consecutiveFailures) ?? 0
    }
}

struct DesktopAutomationEnvelope: Decodable {
    let automations: [DesktopAutomation]
    let canManageSystem: Bool?
}

struct DesktopAutomationRun: Decodable, Identifiable {
    let id: String
    let status: String
    let warning: Bool
    let result: String?
    let error: String?
    let startedAt: String
    let completedAt: String?
    let durationMs: Int?
}

struct DesktopAutomationDetailEnvelope: Decodable {
    let automation: DesktopAutomation
    let runs: [DesktopAutomationRun]
    let total: Int?
}

struct DesktopAutomationPayload: Encodable {
    let name: String
    let prompt: String
    let targetUrl: String
    let monitoringType: String
    let scheduleKind: String
    let intervalMinutes: Int
    let status: String
    let actionType: String
}

struct DesktopCronResourceUsage: Decodable {
    let scope: String?
    let cpuPercent: Double?
    let memoryRssMb: Double?
    let memoryUsedMb: Double?
    let queueDepth: Int?
    let note: String?
}

struct DesktopCronCostEstimate: Decodable {
    let scope: String?
    let hourlyUsd: Double?
    let dailyUsd: Double?
    let assumption: String?
}

struct DesktopCronJob: Decodable, Identifiable {
    let id: String
    let name: String
    let description: String
    let category: String
    let source: String
    let service: String
    let schedule: String
    let cadenceSeconds: Int?
    let enabled: Bool
    let running: Bool
    let status: String
    let lastRunAt: String?
    let lastSuccessAt: String?
    let nextRunAt: String?
    let averageRuntimeMs: Double?
    let failureCount: Int
    let lastError: String?
    let logExcerpt: String?
    let controls: [String]
    let controlMode: String
    let resourceUsage: DesktopCronResourceUsage?
    let costEstimate: DesktopCronCostEstimate?

    enum CodingKeys: String, CodingKey {
        case id, name, description, category, source, service, schedule, cadenceSeconds, enabled, running, status
        case lastRunAt, lastSuccessAt, nextRunAt, averageRuntimeMs, failureCount, lastError, logExcerpt
        case controls, controlMode, resourceUsage, costEstimate
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        name = try values.decode(String.self, forKey: .name)
        description = try values.decodeIfPresent(String.self, forKey: .description) ?? ""
        category = try values.decodeIfPresent(String.self, forKey: .category) ?? "Other/System"
        source = try values.decodeIfPresent(String.self, forKey: .source) ?? ""
        service = try values.decodeIfPresent(String.self, forKey: .service) ?? ""
        schedule = try values.decodeIfPresent(String.self, forKey: .schedule) ?? ""
        cadenceSeconds = try values.decodeIfPresent(Int.self, forKey: .cadenceSeconds)
        enabled = try values.decodeIfPresent(Bool.self, forKey: .enabled) ?? false
        running = try values.decodeIfPresent(Bool.self, forKey: .running) ?? false
        status = try values.decodeIfPresent(String.self, forKey: .status) ?? "unknown"
        lastRunAt = try values.decodeIfPresent(String.self, forKey: .lastRunAt)
        lastSuccessAt = try values.decodeIfPresent(String.self, forKey: .lastSuccessAt)
        nextRunAt = try values.decodeIfPresent(String.self, forKey: .nextRunAt)
        averageRuntimeMs = try values.decodeIfPresent(Double.self, forKey: .averageRuntimeMs)
        failureCount = try values.decodeIfPresent(Int.self, forKey: .failureCount) ?? 0
        lastError = try values.decodeIfPresent(String.self, forKey: .lastError)
        logExcerpt = try values.decodeIfPresent(String.self, forKey: .logExcerpt)
        controls = try values.decodeIfPresent([String].self, forKey: .controls) ?? []
        controlMode = try values.decodeIfPresent(String.self, forKey: .controlMode) ?? "observable_only"
        resourceUsage = try values.decodeIfPresent(DesktopCronResourceUsage.self, forKey: .resourceUsage)
        costEstimate = try values.decodeIfPresent(DesktopCronCostEstimate.self, forKey: .costEstimate)
    }
}

struct DesktopCronJobsEnvelope: Decodable {
    let jobs: [DesktopCronJob]
    let ready: Bool?
}

struct DesktopCronUpdatePayload: Encodable {
    var schedule: String?
    var enabled: Bool?
    var action: String?
}
