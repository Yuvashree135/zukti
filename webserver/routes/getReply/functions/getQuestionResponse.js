let Cookie = require('react-cookie');
// get response of the question asked by user from neo4j database
let getNeo4jDriver = require('../../../neo4j/connection');
let User = require('./../../../models/user');
let client = require('./redis');
let log4js = require('log4js');
let logger = log4js.getLogger();
module.exports = function(intents, keywords, email, types, answerFoundCallback, noAnswerFoundCallback, flag, correctedQuestion) {
    /* @yuvashree: find domain from db using email id */
    User.findOne({
        $or: [
            {
                'local.email': email
            }, {
                'google.email': email
            }, {
                'facebook.email': email
            }
        ]
    }, function(error, data) {
        if (error) {
            return error;
        }
        let domain = data.local.loggedinDomain;
        let query = '';
        let intent = '';
        let flagForType = false;
        let type = '';
        let keyword = '';
        let count = 0;
        getIntent();
        /* @navinprasad: find the base node */
        function getIntent()
        {
          if(types.length === 0)
          {
            client.hmget('intents', intents[intents.length-1],function(err, reply) {
            intent = reply;
            intentCallBack(intent);
            });
          }
          else {
            client.hmget('types', types[types.length-1],function(err, reply) {
            type = reply;
            });
            client.hmget('intents', intents[intents.length-1],function(err, reply) {
            intent = reply;
            intentCallBack(intent);
            });
          }
      }
        function intentCallBack(intent)
        {
          if (types.length === 0) {
          /* @yuvashree: modified query for multiple relationships and different domain for normal question */
              query = `UNWIND ${JSON.stringify(keywords)} AS token
              MATCH (n:concept)
              WHERE n.name = token
              OPTIONAL MATCH (n)-[r:same_as]->(main)
              WITH COLLECT(main) AS baseWords
              UNWIND baseWords AS token
              MATCH p=(token)-[:part_of|:subconcept_of|:actor_of|:same_as*]->(:concept{name:'${domain}'})
              WITH length(p) AS max,baseWords AS baseWords
              with baseWords AS baseWords,max(max) as max
              UNWIND baseWords AS bw
              match p=(bw)-[:part_of|:subconcept_of|:actor_of|:same_as*]->(:concept{name:'${domain}'})
              WHERE length(p) = max WITH COLLECT(bw) AS bws
              UNWIND bws AS keywords
              OPTIONAL MATCH (keywords)<-[r]-(q:question)-[rel:answer]->(a)
              WHERE TYPE(r)='${intent[0]}'
              WITH a as a, rel as rel,keywords as keywords
              OPTIONAL MATCH  (keywords)<-[subconcept_of]-(c:concept)
              WHERE TYPE(subconcept_of)='${intent[0]}'
              WITH a as a, c as c
              RETURN LABELS(a),COLLECT(distinct a.value),LABELS(c),COLLECT(distinct c.name),
              COLLECT(ANY(user IN a.likes WHERE user='${email}')),
              COLLECT(ANY(user IN a.dislikes WHERE user='${email}')),
              CASE
               WHEN SIZE(a.likes)=0 AND SIZE(a.dislikes)=0 THEN 0
               WHEN SIZE(a.likes)=0 AND SIZE(a.dislikes)>0 THEN -SIZE(a.dislikes)
               WHEN SIZE(a.likes)>0 AND SIZE(a.dislikes)>=0 THEN (SIZE(a.likes)*100)/(SIZE(a.likes)+SIZE(a.dislikes))
              END
              AS rating
              ORDER BY rating DESC `;
          }
            /* @yuvashree: modified query for multiple relationships and different domain for type specific question */
            else {
              flagForType = true;
              query = `UNWIND ${JSON.stringify(keywords)} AS token
                MATCH (n:concept)
                WHERE n.name = token
                OPTIONAL MATCH (n)-[r:same_as]->(main)
                WITH COLLECT(main) AS baseWords
                UNWIND baseWords AS token
                MATCH p=(token)-[:part_of|:subconcept_of|:actor_of|:same_as*]->(:concept{name:'${domain}'})
                WITH length(p) AS max,baseWords AS baseWords
                with baseWords AS baseWords,max(max) as max
                UNWIND baseWords AS bw
                match p=(bw)-[:part_of|:subconcept_of|:actor_of|:same_as*]->(:concept{name:'${domain}'})
                WHERE length(p) = max WITH COLLECT(bw) AS bws
                UNWIND bws AS keywords
                MATCH (keywords)<-[r]-(q:question)-[rel:answer]->(a)
                WHERE TYPE(r)='${intent[0]}' and labels(a)='${type[0]}'
                WITH a as a, rel as rel
                RETURN LABELS(a) AS contentType, COLLECT(DISTINCT[a.value, ANY(user IN a.likes WHERE user='${email}'),
                ANY(user IN a.dislikes WHERE user='${email}')]),
                CASE
                 WHEN SIZE(a.likes)=0 AND SIZE(a.dislikes)=0 THEN 0
                 WHEN SIZE(a.likes)=0 AND SIZE(a.dislikes)>0 THEN -SIZE(a.dislikes)
                 WHEN SIZE(a.likes)>0 AND SIZE(a.dislikes)>=0 THEN (SIZE(a.likes)*100)/(SIZE(a.likes)+SIZE(a.dislikes))
                END
                AS rating
                ORDER BY rating DESC `;
          }
        let session = getNeo4jDriver().session();
        session.run(query).then(function(resultObj) {
            // Completed!
            session.close();
            //  @Mayanka: No records found
            if (resultObj.records.length === 0) {
              /* @Sindhujaadevi: To find if the question is from different domain or not */
            client.hmget('keywords', keywords[keywords.length-1],function(err, reply) {
            keyword = reply;
            if (domain !== keyword) {
                      noAnswerFoundCallback(keyword, true);
                  }
            else{
                      noAnswerFoundCallback(keyword, false);
                }
            });

          } else {
                let answerObj = {};
            // @sangeetha : recommendations keywords  for QuestionResponse
                answerObj.keywords = keywords;
                answerObj.time = new Date().toLocaleString();
                //  @Mayanka: If spell check done show this message
                if (flag == 1) {
                    answerObj.extras = 'Showing results for : ' +
                        "\"" + correctedQuestion + "\"" + ' instead';
                }
                let blogArray = [];
                let videoArray = [];
                let codeArray = [];
                let imageArray = [];
                let textArray = [];
                let answerObjArray = [];
                if(flagForType){
                  resultObj.records.forEach((record) => {
                    let field = record._fields;
                    let contentType = field[0][0];
                    if(field[0] !== null){
                        field[1].map((value,index) =>{
                        let content = { value: value[0], likes: value[1], dislikes: value[2]}
                        if(contentType === 'blog') {
                          blogArray.push(content);
                        } else if(contentType === 'video') {
                          videoArray.push(content);
                        } else if(contentType === 'code') {
                          codeArray.push(content);
                        } else if(contentType === 'image') {
                          imageArray.push(content);
                        } else if(contentType === 'text') {
                          textArray.push(content);
                        }
                      });
                      if(blogArray.length > 0) {
                        answerObj['blog'] = blogArray;
                      }
                      if(videoArray.length > 0) {
                        answerObj['video'] = videoArray;
                      }
                      if(codeArray.length > 0) {
                        answerObj['code'] = codeArray;
                      }
                      if(imageArray.length > 0) {
                        answerObj['image'] = imageArray;
                      }
                      if(textArray.length > 0) {
                        answerObj['text'] = textArray;
                      }
                    }
                  });
                  flagForType = false;
                }

                else{
                resultObj.records.forEach((record) => {
                    let field = record._fields;
                    if(field[0] !== null)
                    {
                    let contentType = field[0][0];

                     field[1].map((value, index) => {
                      let content = {value: value, likes: field[4][index], dislikes: field[5][index]};
                      if(contentType === 'blog') {
                        blogArray.push(content);
                      } else if(contentType === 'video') {
                        videoArray.push(content);
                      } else if(contentType === 'code') {
                        codeArray.push(content);
                      } else if(contentType === 'image') {
                        imageArray.push(content);
                      } else if(contentType === 'text') {
                        textArray.push(content);
                      }
                  });

                if(blogArray.length > 0) {
                  answerObj['blog'] = blogArray;
                }
                if(videoArray.length > 0) {
                  answerObj['video'] = videoArray;
                }
                if(codeArray.length > 0) {
                  answerObj['code'] = codeArray;
                }
                if(imageArray.length > 0) {
                  answerObj['image'] = imageArray;
                }
                if(textArray.length > 0) {
                  answerObj['text'] = textArray;
                }
              }
                else {
                  if(field[2] !== null)
                  {
                  field[3] = {
                    value:field[3].join(",")
                  }
                  answerObj[field[2][0]] = field[3];
                }
                else {
                  count = 1;
                  /* @vibakar & Threka : calling noAnswerFoundCallback for fetching answer from stackoverflow,
                                          when answer is not found in our db */
                  noAnswerFoundCallback();
                }

                }
              });
            }
            answerObjArray.push(answerObj);
                // sending the answer to callback
                if(count == 0)
                answerFoundCallback(answerObjArray);
            }
        }).catch(function(error) {
            logger.debug(error);
        });
      }
    });
};
