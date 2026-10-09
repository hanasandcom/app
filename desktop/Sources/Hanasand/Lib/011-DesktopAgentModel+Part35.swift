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

    func loadHanasandTrafficMetrics(loadID: UUID) async {
        isLoadingNativeDashboard = true
        nativeDashboardStatus = "Loading traffic metrics"
        defer {
            if nativeDashboardLoadID == loadID {
                isLoadingNativeDashboard = false
            }
        }

        do {
            let summaryURL = trafficSummaryURL(metric: "domain")
            let summary: [HanasandTrafficSummaryMetric] = try await requestJSON(summaryURL)
            let liveDomains = (try? await requestJSON(trafficTPSURL()) as [HanasandTrafficDomainTPS]) ?? []
            guard !Task.isCancelled, nativeDashboardLoadID == loadID, selectedDashboardPath == "/traffic" else { return }
            let byLiveName = Dictionary(uniqueKeysWithValues: liveDomains.map { ($0.name, $0) })
            let topDomains = summary
                .filter { !$0.value.isEmpty }
                .sorted { $0.bestCount > $1.bestCount }
                .prefix(10)
                .map { item in
                    DashboardTrafficMetrics.Metric(
                        key: item.value,
                        count: item.bestCount > 0 ? item.bestCount : Int((byLiveName[item.value]?.tps ?? 0).rounded())
                    )
                }
            let fallbackDomains = liveDomains
                .filter { !$0.name.isEmpty }
                .prefix(10)
                .map { DashboardTrafficMetrics.Metric(key: $0.name, count: Int(($0.tps ?? 0).rounded())) }
            let domains = topDomains.isEmpty ? fallbackDomains : Array(topDomains)
            let total = summary.reduce(0) { $0 + $1.bestCount }

            trafficMetrics = DashboardTrafficMetrics(
                totalRequests: total,
                avgRequestTime: 0,
                errorRate: 0,
                topDomains: domains
            )
            nativeDashboardStatus = "Loaded traffic metrics"
            nativeDashboardPayload = trafficPayload(total: total, domains: domains)
        } catch {
            guard !Task.isCancelled, nativeDashboardLoadID == loadID, selectedDashboardPath == "/traffic" else { return }
            nativeDashboardStatus = error.localizedDescription
            nativeDashboardPayload = "Could not load Hanasand traffic metrics: \(error.localizedDescription)"
        }
    }

    func trafficSummaryURL(metric: String) -> URL {
        var components = URLComponents(
            url: settings.cdnBaseURL.normalizedBaseURL.appendingAPIPath("traffic/summary"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [URLQueryItem(name: "metric", value: metric)]
        return components?.url ?? settings.cdnBaseURL.normalizedBaseURL.appendingAPIPath("traffic/summary")
    }

    func trafficTPSURL() -> URL {
        var components = URLComponents(
            url: settings.cdnBaseURL.normalizedBaseURL.appendingAPIPath("traffic/tps"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [URLQueryItem(name: "fresh", value: "1")]
        return components?.url ?? settings.cdnBaseURL.normalizedBaseURL.appendingAPIPath("traffic/tps")
    }

    func trafficPayload(total: Int, domains: [DashboardTrafficMetrics.Metric]) -> String {
        let lines = domains.map { "  { \"key\": \"\($0.key)\", \"count\": \($0.count) }" }.joined(separator: ",\n")
        return """
        {
          "source": "Hanasand",
          "total_requests": \(total),
          "top_domains": [
        \(lines)
          ]
        }
        """
    }
}
