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

struct ArticlesNativePanel: View {
    @EnvironmentObject var model: DesktopAgentModel
    @Environment(\.desktopTheme) var theme
    @State var deletingArticle: DashboardArticle?

    let columns = [
        GridItem(.adaptive(minimum: 270), spacing: 12, alignment: .top),
    ]

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 12) {
                NativeGroupPanel(title: "Create article", subtitle: "Markdown article through the API") {
                    TextField("article-id.md or heading slug", text: $model.articleDraftID)
                        .textFieldStyle(.plain)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(theme.text)
                        .padding(12)
                        .background(theme.field)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

                    TextEditor(text: $model.articleDraftContent)
                        .font(.system(size: 13, weight: .semibold, design: .monospaced))
                        .foregroundStyle(theme.text)
                        .scrollContentBackground(.hidden)
                        .padding(8)
                        .frame(minHeight: 220)
                        .background(theme.field)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

                    HStack {
                        Text(model.articleDraftContent.isEmpty ? "Start with a markdown heading." : "\(model.articleDraftContent.count) chars")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(theme.textTertiary)
                        Spacer()
                        ActionButton(title: "Create", icon: "plus") {
                            Task { await model.createNativeArticle() }
                        }
                        .disabled(model.isLoadingNativeDashboard)
                    }
                }

                NativeGroupPanel(title: "Edit article", subtitle: model.selectedArticleID.isEmpty ? "Choose an article from the list." : model.selectedArticleID) {
                    TextField("Article id", text: $model.articleEditID)
                        .textFieldStyle(.plain)
                        .font(.system(size: 13, weight: .semibold, design: .monospaced))
                        .foregroundStyle(theme.text)
                        .padding(12)
                        .background(theme.field)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

                    TextEditor(text: $model.articleEditContent)
                        .font(.system(size: 13, weight: .semibold, design: .monospaced))
                        .foregroundStyle(theme.text)
                        .scrollContentBackground(.hidden)
                        .padding(8)
                        .frame(minHeight: 280)
                        .background(theme.field)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

                    HStack {
                        Text(model.selectedArticleID.isEmpty ? "No article selected." : "\(model.articleEditContent.count) chars")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(theme.textTertiary)
                        Spacer()
                        ActionButton(title: "Save", icon: "checkmark") {
                            Task { await model.updateSelectedArticle() }
                        }
                        .disabled(model.selectedArticleID.isEmpty || model.isLoadingNativeDashboard)
                    }
                }
            }
            .frame(width: 410)

            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    Label("\(model.articles.count) articles", systemImage: "text.alignleft")
                    Text("·")
                    Text("Source: Git")
                }
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(theme.textSecondary)
                HStack {
                    Text(model.articles.isEmpty ? "No articles loaded yet." : "Published articles")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(theme.textTertiary)
                    Spacer()
                    ActionButton(title: "Refresh", icon: "arrow.clockwise") {
                        Task { await model.loadNativeDashboardData() }
                    }
                }

                if model.articles.isEmpty {
                    NativeEmptyState(title: "No articles loaded", message: "Create an article or refresh the API-backed article list.")
                } else {
                    LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
                        ForEach(model.articles) { article in
                            VStack(alignment: .leading, spacing: 10) {
                                Text(article.title)
                                    .font(.system(size: 15, weight: .black))
                                    .foregroundStyle(theme.text)
                                    .lineLimit(2)
                                Text(article.metadata?.description ?? article.id)
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(theme.textSecondary)
                                    .lineLimit(3)
                                HStack(spacing: 8) {
                                    Label(article.readingLabel, systemImage: "book")
                                    Label(article.publishedLabel, systemImage: "clock")
                                }
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(theme.textTertiary)
                                .lineLimit(1)
                                HStack {
                                    Button("Open") {
                                        model.openArticle(article)
                                    }
                                    .buttonStyle(.plain)
                                    .font(.system(size: 12, weight: .bold))
                                    .foregroundStyle(theme.accent)
                                    Button("Edit") {
                                        model.loadArticleIntoEditor(article)
                                    }
                                    .buttonStyle(.plain)
                                    .font(.system(size: 12, weight: .bold))
                                    .foregroundStyle(theme.textSecondary)
                                    Button("Delete") {
                                        deletingArticle = article
                                    }
                                    .buttonStyle(.plain)
                                    .font(.system(size: 12, weight: .bold))
                                    .foregroundStyle(theme.danger)
                                    Spacer()
                                    Text(article.id)
                                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                                        .foregroundStyle(theme.textTertiary)
                                        .lineLimit(1)
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
        }
        .alert("Delete article?", isPresented: Binding(
            get: { deletingArticle != nil },
            set: { if !$0 { deletingArticle = nil } }
        )) {
            Button("Cancel", role: .cancel) {
                deletingArticle = nil
            }
            Button("Delete", role: .destructive) {
                if let deletingArticle {
                    Task { await model.deleteSelectedArticle(deletingArticle) }
                }
                deletingArticle = nil
            }
        } message: {
            Text(deletingArticle?.title ?? "This article will be removed.")
        }
    }
}
