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

extension DesktopAgentModel {

    func loadNativeShareTree(_ share: DashboardShare) async {
        isLoadingNativeDashboard = true
        nativeDashboardStatus = "Loading share tree"
        defer { isLoadingNativeDashboard = false }

        do {
            let tree: [DashboardShareTreeItem] = try await requestJSON(
                settings.cdnBaseURL.normalizedBaseURL.appendingAPIPath("share/tree/\(share.id)"),
                authenticated: true
            )
            shareTrees[share.id] = tree
            nativeDashboardStatus = tree.isEmpty ? "No tree entries returned." : "Loaded \(tree.count) tree entries."
        } catch {
            nativeDashboardStatus = error.localizedDescription
        }
    }

    func deleteNativeShare(_ share: DashboardShare) async {
        isLoadingNativeDashboard = true
        nativeDashboardStatus = "Deleting share"
        defer { isLoadingNativeDashboard = false }

        do {
            _ = try await requestPrettyText(
                settings.cdnBaseURL.normalizedBaseURL.appendingAPIPath("share/\(share.id)"),
                method: "DELETE",
                authenticated: true
            )
            if selectedShareID == share.id {
                selectedShareID = ""
                shareEditName = ""
                shareEditPath = ""
                shareEditContent = ""
            }
            nativeDashboardStatus = "Deleted share."
            append(meta: "Share deleted", body: share.id, kind: .change)
            await loadNativeDashboardData()
        } catch {
            nativeDashboardStatus = error.localizedDescription
        }
    }

    func createNativeArticle() async {
        guard hasHanasandAuth else {
            nativeDashboardStatus = "Hanasand session is not ready. Log in again if this persists."
            return
        }

        let content = articleDraftContent.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else {
            nativeDashboardStatus = "Write article markdown first."
            return
        }

        let explicitID = articleDraftID.trimmingCharacters(in: .whitespacesAndNewlines)
        let heading = content.split(separator: "\n").first { $0.hasPrefix("# ") }
            .map { String($0.dropFirst(2)).trimmingCharacters(in: .whitespacesAndNewlines) }
        let baseID = explicitID.isEmpty ? (heading ?? "desktop-article") : explicitID
        let id = baseID.slugifiedPath + (baseID.hasSuffix(".md") ? "" : ".md")
        let body = (try? JSONEncoder().encode(["content": content])) ?? Data("{}".utf8)

        isLoadingNativeDashboard = true
        nativeDashboardStatus = "Creating article"
        defer { isLoadingNativeDashboard = false }

        do {
            _ = try await requestPrettyText(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("article/\(id)"),
                method: "POST",
                body: body,
                authenticated: true
            )
            nativeDashboardStatus = "Created \(id)"
            articleDraftID = ""
            articleDraftContent = ""
            append(meta: "Article created", body: id, kind: .change)
            await loadNativeDashboardData()
        } catch {
            nativeDashboardStatus = error.localizedDescription
            append(meta: "Article failed", body: error.localizedDescription, kind: .error)
        }
    }

    func loadArticleIntoEditor(_ article: DashboardArticle) {
        selectedArticleID = article.id
        articleEditID = article.id
        articleEditContent = article.content ?? ""
        if article.content == nil {
            Task { await loadArticleContent(article) }
        }
    }

    func loadArticleContent(_ article: DashboardArticle) async {
        do {
            let loaded: DashboardArticle = try await requestJSON(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("article/\(article.id)"),
                authenticated: false
            )
            guard selectedArticleID == article.id else { return }
            articleEditID = loaded.id
            articleEditContent = loaded.content ?? articleEditContent
            if let index = articles.firstIndex(where: { $0.id == article.id }) {
                articles[index] = loaded
            }
            nativeDashboardStatus = "Loaded \(loaded.id)"
        } catch {
            nativeDashboardStatus = error.localizedDescription
        }
    }

    func updateSelectedArticle() async {
        guard hasHanasandAuth else {
            nativeDashboardStatus = "Hanasand session is not ready. Log in again if this persists."
            return
        }

        let id = (articleEditID.isEmpty ? selectedArticleID : articleEditID).trimmingCharacters(in: .whitespacesAndNewlines)
        let content = articleEditContent.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else {
            nativeDashboardStatus = "Select an article first."
            return
        }
        guard !content.isEmpty else {
            nativeDashboardStatus = "Article content cannot be empty."
            return
        }

        let body = (try? JSONEncoder().encode(["content": content])) ?? Data("{}".utf8)
        isLoadingNativeDashboard = true
        nativeDashboardStatus = "Saving article"
        defer { isLoadingNativeDashboard = false }

        do {
            _ = try await requestPrettyText(
                settings.apiBaseURL.normalizedBaseURL.appendingAPIPath("article/\(id)"),
                method: "PUT",
                body: body,
                authenticated: true
            )
            nativeDashboardStatus = "Saved \(id)"
            append(meta: "Article saved", body: id, kind: .change)
            await loadNativeDashboardData()
        } catch {
            nativeDashboardStatus = error.localizedDescription
            append(meta: "Article save failed", body: error.localizedDescription, kind: .error)
        }
    }
}
