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

struct Sidebar: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                HanasandLogo()
                    .frame(width: 28, height: 28)
                Text("Hanasand")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(theme.text)
                Spacer()
            }
            .padding(.horizontal, 18)
            .padding(.top, 16)
            .padding(.bottom, 20)

            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach([DesktopSection.command, .control, .dashboard, .browser, .ide, .mac, .mail, .documents, .images, .server, .updates], id: \.id) { section in
                        NavRow(icon: section.icon, title: section.title, isSelected: model.selectedSection == section) {
                            model.selectedSection = section
                        }
                    }
                    .padding(.horizontal, 8)

                    HStack {
                        Text("Projects")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(theme.textTertiary)
                        Spacer()
                        Button {
                            model.createProject()
                        } label: {
                            Image(systemName: "plus")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(theme.textSecondary)
                                .frame(width: 28, height: 28)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .help("Create project")
                        .accessibilityLabel("Create project")
                    }
                    .padding(.horizontal, 10)
                    .padding(.top, 22)
                    .padding(.bottom, 6)

                    LazyVStack(alignment: .leading, spacing: 2) {
                        ForEach(model.realProjects) { project in
                            ProjectRow(project: project, isSelected: model.selectedSection == .command && model.selectedProject == project.title) {
                                model.selectedSection = .command
                                model.selectedProject = project.title
                            }
                        }
                    }
                    .padding(.horizontal, 8)
                }
                .padding(.bottom, 8)
            }
            .scrollIndicators(.hidden)
            .padding(.horizontal, 8)

            Rectangle()
                .fill(theme.divider)
                .frame(height: 1)
                .padding(.horizontal, 16)

            NavRow(icon: DesktopSection.settings.icon, title: DesktopSection.settings.title, isSelected: model.selectedSection == .settings) {
                model.selectedSection = .settings
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 10)
        }
        .background(theme.sidebar)
    }
}
