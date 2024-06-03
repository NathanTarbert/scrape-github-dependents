require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const cheerio = require('cheerio');
const { Parser } = require('json2csv');

const GITHUB_USERNAME = process.env.GITHUB_USERNAME;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const TARGET_REPO = process.env.TARGET_REPO;
const MAX_DEPENDENTS = 500; // Get the first 110 dependents
const RATE_LIMIT_DELAY = 60000; // 1 minute

async function getDependents(repo) {
  const dependents = [];
  let page = 1;
  
  while (dependents.length < MAX_DEPENDENTS) {
    const url = `https://github.com/${repo}/network/dependents?page=${page}`;
    //console.log(`Fetching: ${url}`);
  
    try {
      const response = await axios.get(url, {
        headers: {
          Accept: 'text/html',
        },
      });
      if (response.status === 200) {
        //fs.writeFileSync(`dependents_page_${page}.html`, response.data); // Save HTML for inspection
        const pageDependents = parseDependentsFromHTML(response.data);
        //console.log(`Dependents on page ${page}:`, pageDependents);
        if (pageDependents.length === 0) {
          break;
        }
        dependents.push(...pageDependents);
        if (dependents.length >= MAX_DEPENDENTS) {
          dependents.length = MAX_DEPENDENTS; // Trim to ensure we only get 110
          break;
        }
      } else {
        console.error(`Failed to fetch dependents: ${response.status}`);
        break;
      }
    } catch (error) {
      if (error.response && error.response.status === 429) {
        console.error('Rate limit exceeded. Waiting for 1 minute before retrying...');
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
      } else {
        console.error(`Error fetching dependents: ${error}`);
        break;
      }
    }
    page++;
  }
  return dependents;
}

function parseDependentsFromHTML(html) {
  const dependents = [];
  const $ = cheerio.load(html);
  $('a[data-hovercard-type="repository"]').each((i, element) => {
    if (dependents.length < MAX_DEPENDENTS) {
      const repo = $(element).attr('href').substring(1); // Remove leading slash
      dependents.push(repo);
    }
  });
  return dependents;
}

async function getFirstContributorDetails(owner, repo) {
  const contributorsUrl = `https://api.github.com/repos/${owner}/${repo}/contributors`;
  try {
    const contributorsResponse = await axios.get(contributorsUrl, {
      auth: {
        username: GITHUB_USERNAME,
        password: GITHUB_TOKEN,
      },
      headers: {
        Accept: 'application/vnd.github.v3+json',
      },
    });
    if (contributorsResponse.status === 200 && contributorsResponse.data.length > 0) {
      const firstContributor = contributorsResponse.data[0];
      const userDetails = await getUserDetails(firstContributor.login);
      const email = await getEmailFromCommits(owner, repo, firstContributor.login);
      return {
        username: firstContributor.login,
        fullName: userDetails.name,
        email: email,
        company: userDetails.company,
        contributions: firstContributor.contributions,
        repository: `${owner}/${repo}`
      };
    } else {
      console.error(`Failed to fetch contributors for ${owner}/${repo}: ${contributorsResponse.status}`);
      return null;
    }
  } catch (error) {
    console.error(`Error fetching contributors for ${owner}/${repo}: ${error}`);
    return null;
  }
}

async function getUserDetails(username) {
  const userUrl = `https://api.github.com/users/${username}`;
  try {
    const response = await axios.get(userUrl, {
      auth: {
        username: GITHUB_USERNAME,
        password: GITHUB_TOKEN,
      },
      headers: {
        Accept: 'application/vnd.github.v3+json',
      },
    });
    if (response.status === 200) {
      return response.data;
    } else {
      console.error(`Failed to fetch user details for ${username}: ${response.status}`);
      return null;
    }
  } catch (error) {
    console.error(`Error fetching user details for ${username}: ${error}`);
    return null;
  }
}

async function getEmailFromCommits(owner, repo, username) {
  const commitsUrl = `https://api.github.com/repos/${owner}/${repo}/commits?author=${username}`;
  try {
    const response = await axios.get(commitsUrl, {
      auth: {
        username: GITHUB_USERNAME,
        password: GITHUB_TOKEN,
      },
      headers: {
        Accept: 'application/vnd.github.v3+json',
      },
    });
    if (response.status === 200 && response.data.length > 0) {
      return response.data[0].commit.author.email;
    } else {
      console.error(`Failed to fetch commits for ${owner}/${repo}: ${response.status}`);
      return null;
    }
  } catch (error) {
    console.error(`Error fetching commits for ${owner}/${repo}: ${error}`);
    return null;
  }
}

(async () => {
  const dependents = await getDependents(TARGET_REPO);
  const contributorDetails = [];

  for (const fullRepoName of dependents) {
    const [owner, repo] = fullRepoName.split('/');
    const contributor = await getFirstContributorDetails(owner, repo);
    if (contributor) {
      contributorDetails.push(contributor);
    }
  }

  console.log(contributorDetails);

  if (contributorDetails.length > 0) {
    const fields = ['username', 'fullName', 'email', 'company', 'contributions', 'repository'];
    const parser = new Parser({ fields });
    const csv = parser.parse(contributorDetails);
    fs.writeFileSync('contributors.csv', csv);
    console.log('CSV file created successfully.');
  } else {
    console.log('No contributor details found.');
  }
})();
