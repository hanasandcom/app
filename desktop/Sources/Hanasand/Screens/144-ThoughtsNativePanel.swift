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

struct ThoughtsNativePanel: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme
    @State var deletingThought: DashboardThought?

    let columns = [
        GridItem(.adaptive(minimum: 230), spacing: 12, alignment: .top),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                FeatureCard(title: "Thoughts", value: "\(model.thoughts.count)", icon: "brain.head.profile")
                FeatureCard(title: "Mode", value: "Native", icon: "macwindow")
            }

            NativeGroupPanel(title: "Create thought", subtitle: "Small idea, saved directly") {
                HStack(spacing: 10) {
                    TextField("Thought title", text: $model.thoughtDraftTitle)
                        .textFieldStyle(.plain)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(theme.text)
                        .padding(12)
                        .background(theme.field)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    ActionButton(title: "Create", icon: "plus") {
                        Task { await model.createNativeThought() }
                    }
                    .disabled(model.isLoadingNativeDashboard)
                    ActionButton(title: "Refresh", icon: "arrow.clockwise") {
                        Task { await model.loadNativeDashboardData() }
                    }
                }
            }

            NativeGroupPanel(title: "Edit thought", subtitle: model.selectedThoughtID.isEmpty ? "Choose a thought below." : model.selectedThoughtID) {
                HStack(spacing: 10) {
                    TextField("Thought title", text: $model.thoughtEditTitle)
                        .textFieldStyle(.plain)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(theme.text)
                        .padding(12)
                        .background(theme.field)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    ActionButton(title: "Save", icon: "checkmark") {
                        Task { await model.updateSelectedThought() }
                    }
                    .disabled(model.selectedThoughtID.isEmpty || model.isLoadingNativeDashboard)
                }
            }

            if model.thoughts.isEmpty {
                NativeEmptyState(title: "No thoughts loaded", message: "Create a thought or refresh the API-backed thought list.")
            } else {
                LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
                    ForEach(model.thoughts) { thought in
                        VStack(alignment: .leading, spacing: 9) {
                            Text(thought.title)
                                .font(.system(size: 14, weight: .black))
                                .foregroundStyle(theme.text)
                                .lineLimit(3)
                            HStack(spacing: 8) {
                                Label(thought.updatedLabel, systemImage: "clock")
                                if let creator = thought.createdBy, !creator.isEmpty {
                                    Label(creator, systemImage: "person.crop.circle")
                                }
                            }
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(theme.textTertiary)
                            .lineLimit(1)
                            HStack(spacing: 12) {
                                Button("Open") {
                                    model.openWebsite(path: "/thoughts/\(thought.id)", label: thought.title)
                                }
                                .buttonStyle(.plain)
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(theme.accent)

                                Button("Edit") {
                                    model.loadThoughtIntoEditor(thought)
                                }
                                .buttonStyle(.plain)
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(theme.textSecondary)

                                Button("Delete") {
                                    deletingThought = thought
                                }
                                .buttonStyle(.plain)
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(theme.danger)
                            }
                        }
                        .padding(13)
                        .background(theme.card)
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(theme.divider, lineWidth: 1)
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                }
            }
        }
        .alert("Delete thought?", isPresented: Binding(
            get: { deletingThought != nil },
            set: { if !$0 { deletingThought = nil } }
        )) {
            Button("Cancel", role: .cancel) {
                deletingThought = nil
            }
            Button("Delete", role: .destructive) {
                if let deletingThought {
                    Task { await model.deleteSelectedThought(deletingThought) }
                }
                deletingThought = nil
            }
        } message: {
            Text(deletingThought?.title ?? "This thought will be removed.")
        }
    }
}
