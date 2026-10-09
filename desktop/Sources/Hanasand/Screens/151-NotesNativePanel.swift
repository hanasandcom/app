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

struct NotesNativePanel: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 10) {
                ActionButton(title: "New note", icon: "plus") {
                    model.newNoteDraft()
                }
                ForEach(model.notes) { note in
                    Button {
                        model.selectNote(note)
                    } label: {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(note.title.isEmpty ? "Untitled" : note.title)
                                .font(.system(size: 14, weight: .bold))
                                .foregroundStyle(theme.text)
                                .lineLimit(1)
                            Text(formatDateText(note.updatedAt, fallback: note.source))
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(theme.textTertiary)
                                .lineLimit(1)
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(model.selectedNoteID == note.id ? theme.sidebarSelected : theme.cardRaised)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
                if model.notes.isEmpty {
                    CompactInfoCard(title: "No notes", lines: ["Create the first shared desktop note."])
                }
            }
            .frame(width: 260, alignment: .topLeading)

            VStack(alignment: .leading, spacing: 12) {
                TextField("Title", text: $model.noteDraftTitle)
                    .textFieldStyle(.plain)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(theme.text)
                    .padding(14)
                    .background(theme.field)
                    .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))

                TextEditor(text: $model.noteDraftContent)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(theme.text)
                    .scrollContentBackground(.hidden)
                    .padding(10)
                    .frame(minHeight: 360)
                    .background(theme.field)
                    .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))

                HStack {
                    Text(model.selectedNoteID.isEmpty ? "New note" : "Editing note")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(theme.textTertiary)
                    Spacer()
                    if !model.selectedNoteID.isEmpty {
                        ActionButton(title: "Delete", icon: "trash", tone: .danger) {
                            Task { await model.deleteSelectedNote() }
                        }
                    }
                    ActionButton(title: "Save", icon: "checkmark") {
                        Task { await model.saveNoteDraft() }
                    }
                }
            }
        }
    }
}
