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

struct SystemCronNativePanel: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme
    @State private var jobs: [DesktopCronJob] = []
    @State private var selectedID = ""
    @State private var searchText = ""
    @State private var selectedStatus = "all"
    @State private var scheduleDraft = ""
    @State private var isLoading = false
    @State private var busyID = ""
    @State private var message = ""

    private var selected: DesktopCronJob? { jobs.first { $0.id == selectedID } }
    private var filtered: [DesktopCronJob] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return jobs.filter { job in
            let textMatch = query.isEmpty || "\(job.name) \(job.category) \(job.description) \(job.service)".lowercased().contains(query)
            let statusMatch = selectedStatus == "all" || job.status == selectedStatus
            return textMatch && statusMatch
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                SearchFieldRow(placeholder: "Search scheduled jobs", text: $searchText)
                    .layoutPriority(1)
                compactControl(title: isLoading ? "Refreshing" : "Refresh", icon: "arrow.clockwise", label: "Refresh scheduled jobs", isDisabled: isLoading) {
                    Task { await load() }
                }
            }

            if !message.isEmpty && !jobs.isEmpty {
                Text(message).font(.system(size: 12, weight: .medium)).foregroundStyle(theme.textSecondary).textSelection(.enabled)
            }

            if isLoading && jobs.isEmpty {
                NativeEmptyState(title: "Loading system jobs", message: "Reading the managed schedule inventory.")
            } else if jobs.isEmpty {
                NativeEmptyState(
                    title: message.isEmpty ? "No system jobs" : "Couldn’t load system jobs",
                    message: message.isEmpty ? "No scheduled jobs were returned." : message
                )
            } else {
                HStack(alignment: .top, spacing: 14) {
                    NativeGroupPanel(title: "Schedule", subtitle: "") {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 6) {
                                ForEach(["all", "failed", "blocked", "running", "enabled", "paused", "observable"], id: \.self) { status in
                                    statusFilter(status)
                                }
                            }
                        }
                        if filtered.isEmpty {
                            Text("No jobs match the active filters.").font(.system(size: 12, weight: .medium)).foregroundStyle(theme.textSecondary)
                        } else {
                            LazyVStack(alignment: .leading, spacing: 6) {
                ForEach(filtered) { job in
                    Button { select(job) } label: { row(job) }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(job.name), \(job.status), \(job.category), \(job.schedule)")
                }
                            }
                        }
                    }
                    .frame(minWidth: 270, maxWidth: 340)

                    if let selected { detail(selected) }
                }
            }
        }
        .task { await load() }
    }

    private func row(_ job: DesktopCronJob) -> some View {
        HStack(spacing: 9) {
            Circle().fill(color(for: job.status)).frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 3) {
                Text(job.name).font(.system(size: 12, weight: .semibold)).foregroundStyle(theme.text).lineLimit(1)
                Text("\(job.category) · \(job.schedule)").font(.system(size: 10, weight: .medium)).foregroundStyle(theme.textTertiary).lineLimit(1)
            }
            Spacer(minLength: 0)
            if job.running { Image(systemName: "waveform.path").font(.system(size: 10, weight: .semibold)).foregroundStyle(theme.accent) }
        }
        .padding(.horizontal, 9).padding(.vertical, 8)
        .background(selectedID == job.id ? theme.accentSoft : theme.cardRaised)
        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
    }

    private func detail(_ job: DesktopCronJob) -> some View {
        NativeGroupPanel(title: job.name, subtitle: "\(job.category) · \(job.service)") {
            labeled("Status", value: job.status.capitalized)
            labeled("Failures", value: "\(job.failureCount)")
            if let averageRuntimeMs = job.averageRuntimeMs {
                labeled("Average run", value: duration(averageRuntimeMs))
            }
            Text(job.description).font(.system(size: 12, weight: .regular)).foregroundStyle(theme.textSecondary).textSelection(.enabled)
            labeled("Schedule", value: job.schedule)
            labeled("Last run", value: job.lastRunAt ?? "Not recorded")
            labeled("Last success", value: job.lastSuccessAt ?? "Not recorded")
            labeled("Next run", value: job.nextRunAt ?? "Not scheduled")

            if job.controls.contains("edit_schedule") {
                HStack(spacing: 8) {
                    TextField("Cron schedule", text: $scheduleDraft).textFieldStyle(.plain).font(.system(size: 12, weight: .medium, design: .monospaced))
                        .padding(10).background(theme.field).clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                    ActionButton(title: "Save schedule", icon: "checkmark") { Task { await update(job, payload: DesktopCronUpdatePayload(schedule: scheduleDraft)) } }
                        .disabled(busyID == job.id || scheduleDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }

            if let error = job.lastError, !error.isEmpty {
                Text(error).font(.system(size: 11, weight: .medium)).foregroundStyle(theme.danger).textSelection(.enabled)
            } else if let excerpt = job.logExcerpt, !excerpt.isEmpty {
                Text(excerpt).font(.system(size: 11, weight: .medium, design: .monospaced)).foregroundStyle(theme.textTertiary).lineLimit(5).textSelection(.enabled)
            }

            HStack(spacing: 8) {
                if job.controls.contains("enable") || job.controls.contains("resume") || job.controls.contains("disable") || job.controls.contains("pause") {
                    ActionButton(title: job.enabled ? "Pause" : "Enable", icon: job.enabled ? "pause.fill" : "play.fill") {
                        Task { await update(job, payload: DesktopCronUpdatePayload(enabled: !job.enabled)) }
                    }.disabled(busyID == job.id)
                }
                if job.controls.contains("run_now") {
                    ActionButton(title: "Run now", icon: "bolt.fill") {
                        Task { await update(job, payload: DesktopCronUpdatePayload(action: "run_now")) }
                    }.disabled(busyID == job.id || job.running)
                }
                if job.controlMode == "observable_only" {
                    Text("View only").font(.system(size: 10, weight: .semibold)).foregroundStyle(theme.textTertiary)
                }
            }

            if let usage = job.resourceUsage {
                Divider().overlay(theme.divider)
                Text("Resource use").font(.system(size: 12, weight: .semibold)).foregroundStyle(theme.text)
                if let scope = usage.scope { labeled("Scope", value: scope) }
                if let cpu = usage.cpuPercent { labeled("CPU", value: String(format: "%.1f%%", cpu)) }
                if let memory = usage.memoryRssMb ?? usage.memoryUsedMb { labeled("Memory", value: String(format: "%.0f MB", memory)) }
                if let queue = usage.queueDepth { labeled("Queue", value: String(queue)) }
                if let note = usage.note, !note.isEmpty { Text(note).font(.system(size: 10, weight: .medium)).foregroundStyle(theme.textTertiary) }
            }

            if let estimate = job.costEstimate {
                Divider().overlay(theme.divider)
                Text("Cost estimate").font(.system(size: 12, weight: .semibold)).foregroundStyle(theme.text)
                if let hourly = estimate.hourlyUsd { labeled("Hourly", value: String(format: "$%.4f / hour", hourly)) }
                if let daily = estimate.dailyUsd { labeled("Daily", value: String(format: "$%.2f / day", daily)) }
                if let scope = estimate.scope, !scope.isEmpty { labeled("Scope", value: scope) }
                if let assumption = estimate.assumption, !assumption.isEmpty {
                    Text(assumption).font(.system(size: 10, weight: .medium)).foregroundStyle(theme.textTertiary).textSelection(.enabled)
                }
            }
        }
        .frame(minWidth: 330, maxWidth: .infinity, alignment: .leading)
    }

    private func labeled(_ label: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(.system(size: 10, weight: .semibold)).foregroundStyle(theme.textTertiary)
            Spacer()
            Text(value).font(.system(size: 11, weight: .medium)).foregroundStyle(theme.textSecondary).lineLimit(2).textSelection(.enabled)
        }
    }

    private func statusFilter(_ status: String) -> some View {
        let isSelected = selectedStatus == status
        return Button {
            selectedStatus = status
        } label: {
            Text(status.capitalized)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(isSelected ? theme.text : theme.textSecondary)
                .padding(.horizontal, 9)
                .frame(height: 27)
                .background(
                    isSelected ? theme.cardRaised : Color.clear,
                    in: RoundedRectangle(cornerRadius: 7, style: .continuous)
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Filter by \(status == "all" ? "all" : status) jobs")
        .accessibilityValue(isSelected ? "Selected" : "Not selected")
    }

    private func compactControl(
        title: String,
        icon: String,
        label: String,
        isDisabled: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(theme.textSecondary)
                .padding(.horizontal, 9)
                .frame(height: 30)
                .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .disabled(isDisabled)
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let envelope = try await model.fetchDesktopCronJobs()
            jobs = envelope.jobs
            if selectedID.isEmpty || !jobs.contains(where: { $0.id == selectedID }) { selectedID = jobs.first?.id ?? "" }
            if let selected { scheduleDraft = selected.schedule }
            message = ""
        } catch { message = error.localizedDescription }
    }

    private func select(_ job: DesktopCronJob) {
        selectedID = job.id
        scheduleDraft = job.schedule
    }

    private func update(_ job: DesktopCronJob, payload: DesktopCronUpdatePayload) async {
        busyID = job.id
        defer { busyID = "" }
        do {
            let envelope = try await model.updateDesktopCronJob(job.id, payload: payload)
            jobs = envelope.jobs
            if !jobs.contains(where: { $0.id == selectedID }) { selectedID = jobs.first?.id ?? "" }
            if let selected { scheduleDraft = selected.schedule }
            message = payload.action == "run_now" ? "Run requested for \(job.name)." : "Saved \(job.name)."
        } catch { message = error.localizedDescription }
    }

    private func color(for status: String) -> Color {
        switch status {
        case "failed", "blocked": return theme.danger
        case "running": return theme.accent
        case "enabled": return theme.green
        default: return theme.textTertiary
        }
    }

    private func duration(_ milliseconds: Double?) -> String {
        guard let milliseconds else { return "—" }
        if milliseconds < 1_000 { return "\(Int(milliseconds)) ms" }
        return String(format: "%.1f s", milliseconds / 1_000)
    }
}
