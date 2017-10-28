const request = require('request-promise-native');
const parseString = require('xml2js').parseString;

/**
 * Query NCBI database using BLAST
 * @param {string} program - blastn, megablast, blastp, blastx, tblastn, tblastx
 * @param {string} database - database from appendix 2 or custom database
 * @param {string} query - Accession, GL or FASTA
 * @param {string} [rid] - Search on an already existing RID
 * @returns {object}
 * @see {@link https://ncbi.github.io/blast-cloud/dev/api.html}
 */

const API_ROOT = 'https://blast.ncbi.nlm.nih.gov/blast/Blast.cgi';

const RID = /^ {4}RID = (.*$)/m;
const RTOE = /^ {4}RTOE = (.*$)/m;
const REFRESH_TIME = 30000;

module.exports = (program = 'blastp', database = 'nr', query = 'protein.fasta', rid = null, context, callback) => {
    if (!['blastn', 'megablast', 'blastp', 'blastx', 'tblastn', 'tblastx'].includes(program)) {
        callback(Error(`${program} is not a supported BLAST algorithm`))
    }

    let fetchInfo = (rid, timeout = REFRESH_TIME) => {
        // How does it work?
        // 1. POST your request to NCBI
        // 2. Check your RID and RTOE (waiting time)
        // 3. Check the query search info (it might not be complete yet)
        // 4. Once that completes, parse XML result (BECAUSE JSON WILL RESULT IN AN ARCHIVE TO DOWNLOAD, WTF)
        // 6. Invoke the callback with the results object
        // NOTE TO NCBI: Your workflow is seriously fucked up.

        setTimeout(() => {
            console.log(`Updating search info for query ${rid} every ${REFRESH_TIME / 1000} seconds.`)
            setInterval(() => {
                console.log(`Updating search info for query ${rid}`)

                request.get(`${API_ROOT}?&CMD=Get&FORMAT_OBJECT=SearchInfo&RID=${rid}`).then((body) => {
                    if (body.indexOf('Status=FAILED') != -1) {
                        callback(Error(`Search ${rid} failed; Please report to blast-help@ncbi.nlm.nih.gov`))
                    } else if (body.indexOf('Status=UNKNOWN') != -1) {
                        callback(Error(`Search ${rid} expired.`))
                    } else if (body.indexOf('Status=READY') != -1) {
                        console.log(`Fetching search results for query ${rid}`)
                        request.get(`${API_ROOT}?CMD=Get&FORMAT_TYPE=XML&RID=${rid}`).then((body) => {
                            parseString(body, (err, result) => {
                                if (err) {
                                    callback(err)
                                }

                                callback(null, result);
                            })
                        }).catch((err) => {
                            callback(err);
                        })
                    }
                }).catch((err) => {
                    callback(err);
                })
            }, REFRESH_TIME)
        }, timeout)
    }

    if (!rid) {
        // This is not documented but can be found in the NCBI sample script at https://blast.ncbi.nlm.nih.gov/docs/web_blast.pl
        // NOTE: rpsblast has been deprecated and is no longer listed on the NCBI algorithm table
        program = (program === 'megablast') ? 'blastp&MEGABLAST=on' : program;
        console.log(`Querying NCBI database ${database} with program ${program} and query ${query}`)

        request.post(API_ROOT).form({
            'CMD': 'Put',
            'PROGRAM': program,
            'DATABASE': database,
            'QUERY': encodeURIComponent(query)
        }).then((body) => {
            let rid = body.match(RID);
            let rtoe = body.match(RTOE);

            fetchInfo(rid[0], rtoe[1]);
        }).catch((err) => {
            callback(err);
        })
    } else {
        console.log(`Fetching results for RID ${rid}`)
        fetchInfo(rid);
    }
}
