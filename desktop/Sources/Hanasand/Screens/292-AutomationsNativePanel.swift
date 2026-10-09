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

struct AutomationsNativePanel: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme
    @State private var automations: [DesktopAutomation] = []
    @State private var runs: [DesktopAutomationRun] = []
    @State private var selectedID = ""
    @State private var searchText = ""
    @State private var isLoading = false
    @State private var busyAction = ""
    @State private var detailRequestID = UUID()
    @State private var message = ""
    @State private var isEditing = false
    @State private var confirmsDelete = false
    @State private var draftName = ""
    @State private var draftURL = ""
    @State private var draftPrompt = ""
    @State private var draftInterval = "15"

    private var selected: DesktopAutomation? { automations.first { $0.id == selectedID } }
    private var filtered: [DesktopAutomation] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return automations }
        return automations.filter { "\($0.name) \($0.targetUrl ?? "") \($0.status)".lowercased().contains(query) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                SearchFieldRow(placeholder: "Search automations", text: $searchText)
                    .layoutPriority(1)
                compactControl(title: "Refresh", icon: "arrow.clockwise", label: "Refresh automations", isDisabled: isLoading) {
                    Task { await load() }
                }
                compactControl(title: "New", icon: "plus", label: "Create automation", prominent: true) {
                    beginCreate()
                }
            }

            if !message.isEmpty && (!automations.isEmpty || isEditing) {
                Text(message)
                    .font(.system(size: 12, weight: .regular))
                    .foregroundStyle(theme.textSecondary)
                    .textSelection(.enabled)
            }

            if isEditing {
                editor
            } else if isLoading && automations.isEmpty {
                NativeEmptyState(title: "Loading automations", message: "Connecting to your Hanasand account.")
            } else if automations.isEmpty {
                NativeEmptyState(
                    title: message.isEmpty ? "No automations yet" : "Couldn’t load automations",
                    message: message.isEmpty ? "Create a check to monitor a website or service on a schedule." : message
                )
            } else {
                HStack(alignment: .top, spacing: 14) {
                    NativeGroupPanel(title: "Automations", subtitle: "") {
                        if filtered.isEmpty {
                            Text("No automations match this search.").font(.system(size: 12, weight: .medium)).foregroundStyle(theme.textSecondary)
                        } else {
                            LazyVStack(alignment: .leading, spacing: 6) {
                                ForEach(filtered) { automation in
                                    Button { Task { await select(automation) } } label: {
                                        automationRow(automation)
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityLabel("\(automation.name), \(automation.status)")
                                }
                            }
                        }
                    }
                    .frame(minWidth: 260, maxWidth: 330)

                    if let selected {
                        detail(selected)
                    } else if isLoading {
                        NativeEmptyState(title: "Loading", message: "Refreshing automation details.")
                    }
                }
            }
        }
        .task { await load() }
        .alert("Delete automation?", isPresented: $confirmsDelete) {
            Button("Delete", role: .destructive) { Task { await deleteSelected() } }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("This removes the automation and its scheduled checks.")
        }
    }

    private var editor: some View {
        NativeGroupPanel(title: selected == nil ? "New automation" : "Edit automation", subtitle: "") {
            field("Name", text: $draftName, placeholder: "Production website")
            field("URL", text: $draftURL, placeholder: "https://example.com")
            field("Check prompt", text: $draftPrompt, placeholder: "Describe what this check should confirm")
            field("Repeat every (minutes)", text: $draftInterval, placeholder: "15")
            HStack(spacing: 10) {
                ActionButton(title: "Cancel", icon: "xmark") { isEditing = false; message = "" }
                ActionButton(title: selected == nil ? "Create" : "Save", icon: "checkmark") { Task { await save() } }
                    .disabled(busyAction == "save")
            }
        }
    }

    private func automationRow(_ automation: DesktopAutomation) -> some View {
        HStack(spacing: 9) {
            Circle().fill(automation.status == "active" ? theme.green : theme.textTertiary).frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 3) {
                Text(automation.name).font(.system(size: 12, weight: .semibold)).foregroundStyle(theme.text).lineLimit(1)
                Text([automation.status.capitalized, automation.lastStatus?.capitalized].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 10, weight: .medium)).foregroundStyle(theme.textTertiary).lineLimit(1)
            }
            Spacer(minLength: 0)
            if selectedID == automation.id { Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold)).foregroundStyle(theme.accent) }
        }
        .padding(.horizontal, 9).padding(.vertical, 8)
        .background(selectedID == automation.id ? theme.accentSoft : theme.cardRaised)
        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
    }

    private func detail(_ automation: DesktopAutomation) -> some View {
        NativeGroupPanel(title: automation.name, subtitle: automation.targetUrl ?? automation.monitoringType.uppercased()) {
            labeled("Status", value: automation.status.capitalized)
            labeled("Checks", value: "\(automation.runCount)")
            labeled("Consecutive failures", value: "\(automation.consecutiveFailures)")
            labeled("Schedule", value: "Every \(automation.intervalMinutes ?? 15) minutes")
            labeled("Last run", value: automation.lastRunAt ?? "Not run")
            labeled("Next run", value: automation.nextRunAt ?? "Not scheduled")
            Text(automation.prompt)
                .font(.system(size: 12, weight: .regular))
                .foregroundStyle(theme.textSecondary)
                .textSelection(.enabled)
            if let result = automation.resultSummary, !result.isEmpty {
                Text(result)
                    .font(.system(size: 12, weight: .regular))
                    .foregroundStyle(automation.lastError == nil ? theme.textSecondary : theme.danger)
                    .textSelection(.enabled)
            }
            HStack(spacing: 8) {
                ActionButton(title: automation.status == "active" ? "Pause" : "Resume", icon: automation.status == "active" ? "pause.fill" : "play.fill") {
                    Task { await setStatus(automation, status: automation.status == "active" ? "paused" : "active") }
                }.disabled(busyAction == automation.id)
                ActionButton(title: "Run now", icon: "bolt.fill") { Task { await runNow(automation) } }.disabled(busyAction == automation.id)
                if automation.actionType == "agent_prompt" {
                    ActionButton(title: "Edit", icon: "pencil") { beginEdit(automation) }
                }
                ActionButton(title: "Delete", icon: "trash", tone: .danger) { confirmsDelete = true }.disabled(busyAction == automation.id)
            }
            Divider().overlay(theme.divider)
            Text("Recent checks").font(.system(size: 12, weight: .semibold)).foregroundStyle(theme.text)
            if runs.isEmpty {
                Text("No check history is available yet.").font(.system(size: 11, weight: .medium)).foregroundStyle(theme.textTertiary)
            } else {
                ForEach(runs) { run in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(run.startedAt).font(.system(size: 10, weight: .medium, design: .monospaced)).foregroundStyle(theme.textTertiary)
                            Spacer()
                            Text(run.warning ? "Warning" : run.status.capitalized).font(.system(size: 10, weight: .semibold)).foregroundStyle(run.status == "failed" ? theme.danger : theme.green)
                        }
                        if let detail = run.error ?? run.result { Text(detail).font(.system(size: 11, weight: .medium)).foregroundStyle(theme.textSecondary).lineLimit(3).textSelection(.enabled) }
                    }.padding(8).background(theme.cardRaised).clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
            }
        }
        .frame(minWidth: 320, maxWidth: .infinity, alignment: .leading)
    }

    private func field(_ title: String, text: Binding<String>, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title).font(.system(size: 10, weight: .semibold)).foregroundStyle(theme.textTertiary)
            TextField(placeholder, text: text).textFieldStyle(.plain).font(.system(size: 12, weight: .medium))
                .padding(10).background(theme.field).clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
    }

    private func labeled(_ label: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(theme.textTertiary)
            Spacer(minLength: 12)
            Text(value)
                .font(.system(size: 11, weight: .regular))
                .foregroundStyle(theme.textSecondary)
                .multilineTextAlignment(.trailing)
                .lineLimit(2)
                .textSelection(.enabled)
        }
    }

    private func compactControl(
        title: String,
        icon: String,
        label: String,
        isDisabled: Bool = false,
        prominent: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(theme.textSecondary)
                .padding(.horizontal, 9)
                .frame(height: 30)
                .background(
                    prominent ? theme.cardRaised : Color.clear,
                    in: RoundedRectangle(cornerRadius: 8, style: .continuous)
                )
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
            automations = try await model.fetchDesktopAutomations()
            if selectedID.isEmpty || !automations.contains(where: { $0.id == selectedID }) { selectedID = automations.first?.id ?? "" }
            if let selected { await loadDetail(selected) }
            message = ""
        } catch { message = error.localizedDescription }
    }

    private func select(_ automation: DesktopAutomation) async {
        selectedID = automation.id
        await loadDetail(automation)
    }

    private func loadDetail(_ automation: DesktopAutomation) async {
        let requestID = UUID()
        detailRequestID = requestID
        do {
            let detail = try await model.fetchDesktopAutomationDetail(automation.id)
            guard !Task.isCancelled, detailRequestID == requestID, selectedID == automation.id else { return }
            runs = detail.runs
            message = ""
        } catch {
            guard !Task.isCancelled, detailRequestID == requestID, selectedID == automation.id else { return }
            runs = []
            message = error.localizedDescription
        }
    }

    private func beginCreate() {
        selectedID = ""
        draftName = ""
        draftURL = ""
        draftPrompt = "Check that the page is available."
        draftInterval = "15"
        isEditing = true
    }

    private func beginEdit(_ automation: DesktopAutomation) {
        draftName = automation.name
        draftURL = automation.targetUrl ?? ""
        draftPrompt = automation.prompt
        draftInterval = String(automation.intervalMinutes ?? 15)
        isEditing = true
    }

    private func save() async {
        guard let interval = Int(draftInterval), interval > 0 else { message = "Enter a repeat interval in minutes."; return }
        let url = draftURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !draftName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !url.isEmpty else { message = "Name and URL are required."; return }
        guard !draftPrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { message = "A check prompt is required."; return }
        let payload = DesktopAutomationPayload(name: draftName, prompt: draftPrompt, targetUrl: url, monitoringType: selected?.monitoringType ?? "fetch", scheduleKind: selected?.scheduleKind ?? "interval", intervalMinutes: interval, status: selected?.status ?? "active", actionType: "agent_prompt")
        busyAction = "save"
        defer { busyAction = "" }
        do {
            let saved = try await model.saveDesktopAutomation(payload, id: selected?.id)
            isEditing = false
            message = "Saved \(saved.name)."
            await load()
            selectedID = saved.id
        } catch { message = error.localizedDescription }
    }

    private func setStatus(_ automation: DesktopAutomation, status: String) async {
        busyAction = automation.id
        defer { busyAction = "" }
        do { try await model.setDesktopAutomationStatus(automation.id, status: status); await load() }
        catch { message = error.localizedDescription }
    }

    private func runNow(_ automation: DesktopAutomation) async {
        busyAction = automation.id
        defer { busyAction = "" }
        do { message = try await model.runDesktopAutomation(automation.id); await load() }
        catch { message = error.localizedDescription }
    }

    private func deleteSelected() async {
        guard let selected else { return }
        busyAction = selected.id
        defer { busyAction = "" }
        do { try await model.deleteDesktopAutomation(selected.id); runs = []; selectedID = ""; message = "Deleted \(selected.name)."; await load() }
        catch { message = error.localizedDescription }
    }
}
